// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { OdooRpcError } from '../../src/api';
import { test, expect } from '../../src/fixtures';

test.describe('Order to Cash', () => {
  test('O2C-N2 Sales user cannot post invoices or move stock (role separation)', async ({ api, apiAs, salesPage }) => {
    const uuid = randomUUID().slice(0, 8);
    const customerName = `PW Customer ${uuid}`;
    const productName = `PW Widget ${uuid}`;

    // 1. SETUP (API): customer, product with stock 20, confirmed sales order of 10 units, draft invoice.
    const [saleTax] = await api.searchRead<{ id: number }>(
      'account.tax',
      [['type_tax_use', '=', 'sale'], ['amount', '=', 6], ['amount_type', '=', 'percent']],
      ['id'],
      { limit: 1 },
    );
    const [category] = await api.searchRead<{ id: number }>('product.category', [['name', '=', 'Goods']], ['id'], { limit: 1 });
    const [warehouse] = await api.searchRead<{ lot_stock_id: [number, string] }>(
      'stock.warehouse',
      [['code', '=', 'WH']],
      ['lot_stock_id'],
      { limit: 1 },
    );
    const stockLocationId = warehouse.lot_stock_id[0];

    const customerId = await api.create('res.partner', { name: customerName });
    const productTemplateId = await api.create('product.template', {
      name: productName,
      type: 'consu',
      is_storable: true,
      categ_id: category.id,
      list_price: 100,
      standard_price: 60,
      taxes_id: [[6, 0, [saleTax.id]]],
    });
    const [product] = await api.searchRead<{ id: number }>('product.product', [['product_tmpl_id', '=', productTemplateId]], ['id']);
    const productId = product.id;

    const quantId = await api.execute<number>(
      'stock.quant',
      'create',
      [{ product_id: productId, location_id: stockLocationId, inventory_quantity: 20 }],
      { context: { inventory_mode: true } },
    );
    await api.execute('stock.quant', 'action_apply_inventory', [[quantId]]);

    const onHand = async () => {
      const quants = await api.searchRead<{ quantity: number }>(
        'stock.quant',
        [['product_id', '=', productId], ['location_id', '=', stockLocationId]],
        ['quantity'],
      );
      return quants.reduce((sum, q) => sum + q.quantity, 0);
    };
    expect(await onHand()).toBe(20);

    const orderId = await api.create('sale.order', {
      partner_id: customerId,
      order_line: [[0, 0, { product_id: productId, product_uom_qty: 10, price_unit: 100, tax_ids: [[6, 0, [saleTax.id]]] }]],
    });
    await api.execute('sale.order', 'action_confirm', [[orderId]]);
    const [order] = await api.read<{ name: string }>('sale.order', [orderId], ['name']);

    // _create_invoices is private and not callable over RPC; the standard invoicing wizard calls it.
    const wizardId = await api.execute<number>(
      'sale.advance.payment.inv',
      'create',
      [{ advance_payment_method: 'delivered' }],
      { context: { active_model: 'sale.order', active_ids: [orderId], active_id: orderId } },
    );
    await api.execute('sale.advance.payment.inv', 'create_invoices', [[wizardId]], {
      context: { active_model: 'sale.order', active_ids: [orderId], active_id: orderId },
    });

    const [invoice] = await api.searchRead<{ id: number; state: string }>(
      'account.move',
      [['partner_id', '=', customerId], ['move_type', '=', 'out_invoice']],
      ['state'],
    );
    expect(invoice.state).toBe('draft');
    const [picking] = await api.searchRead<{ id: number; state: string }>('stock.picking', [['origin', '=', order.name]], ['state']);
    expect(picking.state).toBe('assigned');

    // 2. SALES (Sam Sales): Home Menu shows Sales, not Inventory or Purchase.
    await salesPage.goto('/odoo');
    await salesPage.getByTitle('Home Menu').click();
    await expect(salesPage.getByRole('menuitem', { name: 'Sales', exact: true })).toBeVisible();
    await expect(salesPage.getByRole('menuitem', { name: 'Inventory', exact: true })).toHaveCount(0);
    await expect(salesPage.getByRole('menuitem', { name: 'Purchase', exact: true })).toHaveCount(0);
    await expect(salesPage.getByRole('menuitem', { name: 'Invoicing', exact: true })).toHaveCount(0);
    await salesPage.keyboard.press('Escape');

    // Direct navigation to the draft invoice: access error dialog, or no Confirm button.
    await salesPage.goto(`/odoo/action-account.action_move_out_invoice_type/${invoice.id}`);
    await expect(salesPage.getByRole('dialog').or(salesPage.locator('.o_form_view, .o_action_manager')).first()).toBeVisible();
    await expect(salesPage.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);

    // Direct navigation to the delivery: access error dialog, or no Validate button.
    await salesPage.goto(`/odoo/action-stock.action_picking_tree_all/${picking.id}`);
    await expect(salesPage.getByRole('dialog').or(salesPage.locator('.o_form_view, .o_action_manager')).first()).toBeVisible();
    await expect(salesPage.getByRole('button', { name: 'Validate', exact: true })).toHaveCount(0);

    // API as the sales user: posting raises an AccessError. (Validating a delivery is in its own test below.)
    const salesApi = await apiAs('sales');
    const postError = await salesApi.execute('account.move', 'action_post', [[invoice.id]]).catch((e: unknown) => e);
    expect(postError).toBeInstanceOf(OdooRpcError);
    expect((postError as OdooRpcError).exceptionName).toMatch(/AccessError/);

    // Nothing changed: invoice draft, delivery Ready, stock still 20.
    const [invoiceAfter] = await api.read<{ state: string }>('account.move', [invoice.id], ['state']);
    expect(invoiceAfter.state).toBe('draft');
    const [pickingAfter] = await api.read<{ state: string }>('stock.picking', [picking.id], ['state']);
    expect(pickingAfter.state).toBe('assigned');
    expect(await onHand()).toBe(20);
  });

  test(
    'O2C-N2b Sales user cannot validate a delivery through the API',
    {
      annotation: {
        type: 'bug',
        description:
          'Segregation of duties: a Sales: User can validate a delivery through the external API (stock.picking.button_validate), although the UI hides it',
      },
    },
    async ({ api, apiAs }) => {
      test.fail();
      const uuid = randomUUID().slice(0, 8);

      // SETUP (API, admin): customer, product with stock 20, confirmed sales order of 10 units.
      const [category] = await api.searchRead<{ id: number }>('product.category', [['name', '=', 'Goods']], ['id'], { limit: 1 });
      const [warehouse] = await api.searchRead<{ lot_stock_id: [number, string] }>(
        'stock.warehouse',
        [['code', '=', 'WH']],
        ['lot_stock_id'],
        { limit: 1 },
      );
      const stockLocationId = warehouse.lot_stock_id[0];
      const customerId = await api.create('res.partner', { name: `PW Customer ${uuid}` });
      const productTemplateId = await api.create('product.template', {
        name: `PW Widget ${uuid}`,
        type: 'consu',
        is_storable: true,
        categ_id: category.id,
        list_price: 100,
        standard_price: 60,
      });
      const [product] = await api.searchRead<{ id: number }>('product.product', [['product_tmpl_id', '=', productTemplateId]], ['id']);
      const productId = product.id;
      const quantId = await api.execute<number>(
        'stock.quant',
        'create',
        [{ product_id: productId, location_id: stockLocationId, inventory_quantity: 20 }],
        { context: { inventory_mode: true } },
      );
      await api.execute('stock.quant', 'action_apply_inventory', [[quantId]]);
      const orderId = await api.create('sale.order', {
        partner_id: customerId,
        order_line: [[0, 0, { product_id: productId, product_uom_qty: 10, price_unit: 100 }]],
      });
      await api.execute('sale.order', 'action_confirm', [[orderId]]);
      const [order] = await api.read<{ name: string }>('sale.order', [orderId], ['name']);
      const [picking] = await api.searchRead<{ id: number; state: string }>('stock.picking', [['origin', '=', order.name]], ['state']);
      expect(picking.state).toBe('assigned');

      // SALES (Sam Sales, API): validating the delivery must raise an AccessError.
      const salesApi = await apiAs('sales');
      const validateError = await salesApi.execute('stock.picking', 'button_validate', [[picking.id]]).catch((e: unknown) => e);
      expect(validateError).toBeInstanceOf(OdooRpcError);
      expect((validateError as OdooRpcError).exceptionName).toMatch(/AccessError/);

      // Nothing changed: delivery still Ready.
      const [pickingAfter] = await api.read<{ state: string }>('stock.picking', [picking.id], ['state']);
      expect(pickingAfter.state).toBe('assigned');
    },
  );
});

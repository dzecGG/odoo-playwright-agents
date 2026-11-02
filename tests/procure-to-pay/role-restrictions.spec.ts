// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { OdooRpcError } from '../../src/api';
import { test, expect } from '../../src/fixtures';

test.describe('Procure to Pay', () => {
  test('P2P-N2 Warehouse user cannot confirm purchase orders or post vendor bills (role separation)', async ({ api, apiAs, warehousePage }) => {
    const uuid = randomUUID().slice(0, 8);
    const vendorName = `PW Vendor ${uuid}`;
    const productName = `PW Part ${uuid}`;

    // 1. SETUP (API, admin): vendor, product, a draft RFQ of 10 units at 60.00 and a draft vendor bill.
    const [purchaseTax] = await api.searchRead<{ id: number }>(
      'account.tax',
      [['type_tax_use', '=', 'purchase'], ['amount', '=', 6], ['amount_type', '=', 'percent']],
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

    const vendorId = await api.create('res.partner', { name: vendorName });
    const productTemplateId = await api.create('product.template', {
      name: productName,
      type: 'consu',
      is_storable: true,
      categ_id: category.id,
      list_price: 100,
      standard_price: 60,
      supplier_taxes_id: [[6, 0, [purchaseTax.id]]],
    });
    const [product] = await api.searchRead<{ id: number }>('product.product', [['product_tmpl_id', '=', productTemplateId]], ['id']);
    const productId = product.id;

    const onHand = async () => {
      const quants = await api.searchRead<{ quantity: number }>(
        'stock.quant',
        [['product_id', '=', productId], ['location_id', '=', stockLocationId]],
        ['quantity'],
      );
      return quants.reduce((sum, q) => sum + q.quantity, 0);
    };

    const orderId = await api.create('purchase.order', {
      partner_id: vendorId,
      order_line: [[0, 0, { product_id: productId, product_qty: 10, price_unit: 60, tax_ids: [[6, 0, [purchaseTax.id]]] }]],
    });
    const billId = await api.create('account.move', {
      move_type: 'in_invoice',
      partner_id: vendorId,
      invoice_date: new Date().toISOString().slice(0, 10),
      invoice_line_ids: [
        [0, 0, { product_id: productId, quantity: 10, price_unit: 60, tax_ids: [[6, 0, [purchaseTax.id]]] }],
      ],
    });

    const [orderBefore] = await api.read<{ state: string }>('purchase.order', [orderId], ['state']);
    expect(orderBefore.state).toBe('draft');
    const [billBefore] = await api.read<{ state: string }>('account.move', [billId], ['state']);
    expect(billBefore.state).toBe('draft');

    // 2. WAREHOUSE (Wes Warehouse, warehousePage): open the Home Menu, then navigate directly to the RFQ and the bill by URL.
    await warehousePage.goto('/odoo');
    await warehousePage.getByTitle('Home Menu').click();
    await expect(warehousePage.getByRole('menuitem', { name: 'Inventory', exact: true })).toBeVisible();
    await expect(warehousePage.getByRole('menuitem', { name: 'Purchase', exact: true })).toHaveCount(0);
    await expect(warehousePage.getByRole('menuitem', { name: 'Invoicing', exact: true })).toHaveCount(0);
    await warehousePage.keyboard.press('Escape');

    // Direct navigation to the RFQ: access error dialog, or no Confirm Order button.
    await warehousePage.goto(`/odoo/action-purchase.purchase_rfq/${orderId}`);
    await expect(warehousePage.getByRole('dialog').or(warehousePage.locator('.o_form_view, .o_action_manager')).first()).toBeVisible();
    await expect(warehousePage.getByRole('button', { name: 'Confirm Order' })).toHaveCount(0);

    // Direct navigation to the vendor bill: access error dialog, or no Confirm button.
    await warehousePage.goto(`/odoo/action-account.action_move_in_invoice_type/${billId}`);
    await expect(warehousePage.getByRole('dialog').or(warehousePage.locator('.o_form_view, .o_action_manager')).first()).toBeVisible();
    await expect(warehousePage.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);

    // API as the warehouse user: confirming and posting raise an AccessError.
    const warehouseApi = await apiAs('warehouse');
    const confirmError = await warehouseApi.execute('purchase.order', 'button_confirm', [[orderId]]).catch((e: unknown) => e);
    expect(confirmError).toBeInstanceOf(OdooRpcError);
    expect((confirmError as OdooRpcError).exceptionName).toMatch(/AccessError/);

    const postError = await warehouseApi.execute('account.move', 'action_post', [[billId]]).catch((e: unknown) => e);
    expect(postError).toBeInstanceOf(OdooRpcError);
    expect((postError as OdooRpcError).exceptionName).toMatch(/AccessError/);

    // Nothing changed: RFQ draft, bill draft, no stock and no journal items.
    const [orderAfter] = await api.read<{ state: string }>('purchase.order', [orderId], ['state']);
    expect(orderAfter.state).toBe('draft');
    const [billAfter] = await api.read<{ state: string }>('account.move', [billId], ['state']);
    expect(billAfter.state).toBe('draft');
    expect(await api.searchCount('stock.picking', [['purchase_id', '=', orderId]])).toBe(0);
    expect(await onHand()).toBe(0);
    expect(await api.searchCount('account.move.line', [['move_id', '=', billId], ['parent_state', '=', 'posted']])).toBe(0);
  });
});

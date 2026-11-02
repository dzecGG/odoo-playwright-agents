// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures';

test.describe('Order to Cash', () => {
  test('O2C-N1 Quotation cannot be saved or confirmed without a customer', async ({ api, salesPage }) => {
    const uuid = randomUUID().slice(0, 8);
    const customerName = `PW Customer ${uuid}`;
    const productName = `PW Widget ${uuid}`;

    // 1. SETUP (API): create a storable product (stock 20).
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

    // SALES (Sam Sales): new quotation, no customer, product with quantity 5, save.
    await salesPage.goto('/odoo/action-sale.action_quotations_with_onboarding/new');
    await salesPage.getByRole('button', { name: 'Add a product' }).click();
    await salesPage.getByRole('combobox', { name: 'Search a product' }).fill(productName);
    await salesPage.getByRole('option', { name: productName }).first().click();
    await salesPage.locator('td[name="product_uom_qty"] input').first().fill('5');
    await salesPage.getByRole('button', { name: 'Save manually' }).click();

    // expect: the Customer field is flagged invalid and nothing is saved.
    await expect(salesPage.locator('div[name="partner_id"].o_field_invalid')).toBeVisible();
    await expect(salesPage).toHaveURL(/\/new$/);
    expect(await api.searchCount('sale.order.line', [['product_id', '=', productId]])).toBe(0);

    // 2. Fill the customer and save, then click Confirm.
    await salesPage.getByRole('combobox', { name: 'Customer' }).fill(customerName);
    await salesPage.getByRole('option', { name: customerName }).first().click();
    await salesPage.getByRole('button', { name: 'Save manually' }).click();
    await expect(salesPage.getByRole('radio', { name: 'Quotation', exact: true })).toBeChecked();
    await expect(salesPage.locator('div[name="partner_id"].o_field_invalid')).toHaveCount(0);

    await salesPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(salesPage.getByRole('radio', { name: 'Sales Order', exact: true })).toBeChecked();
    // Sam (Sales: User) has no Inventory rights, so Odoo hides the Delivery button from him; the delivery is checked through the API below.

    const [order] = await api.searchRead<{ name: string; state: string }>(
      'sale.order',
      [['partner_id', '=', customerId]],
      ['name', 'state'],
    );
    expect(order.state).toBe('sale');
    expect(await api.searchCount('sale.order.line', [['product_id', '=', productId]])).toBe(1);
    expect(await api.searchCount('stock.picking', [['origin', '=', order.name]])).toBe(1);

    expect(await onHand()).toBe(20);
    expect(await api.searchCount('account.move.line', [['product_id', '=', productId]])).toBe(0);
    expect(await api.searchCount('account.move', [['partner_id', '=', customerId]])).toBe(0);
  });
});

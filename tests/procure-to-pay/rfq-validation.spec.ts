// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures';

test.describe('Procure to Pay', () => {
  test('P2P-N1 Purchase order cannot be saved without a vendor', async ({ api, purchasePage }) => {
    const uuid = randomUUID().slice(0, 8);
    const vendorName = `PW Vendor ${uuid}`;
    const productName = `PW Part ${uuid}`;

    // 1. SETUP (API): create a product.
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
    expect(await onHand()).toBe(0);

    // PURCHASING (Pat Purchase): new RFQ, leave Vendor empty, add the product with quantity 5, save.
    await purchasePage.goto('/odoo/action-purchase.purchase_rfq/new');
    await purchasePage.getByRole('button', { name: 'Add a product' }).click();
    await purchasePage.locator('td[name="product_id"] input').first().fill(productName);
    await purchasePage.getByRole('option', { name: productName }).first().click();
    await purchasePage.locator('td[name="product_qty"] input').first().fill('5');
    await purchasePage.getByRole('button', { name: 'Save manually' }).click();

    // expect: the Vendor field is flagged invalid and nothing is saved.
    await expect(purchasePage.locator('div[name="partner_id"].o_field_invalid')).toBeVisible();
    await expect(purchasePage).toHaveURL(/\/new$/);
    expect(await api.searchCount('purchase.order.line', [['product_id', '=', productId]])).toBe(0);

    // 2. Choose an API-created vendor, save, and click Confirm Order.
    await purchasePage.getByRole('combobox', { name: 'Vendor' }).fill(vendorName);
    await purchasePage.getByRole('option', { name: vendorName }).first().click();
    await purchasePage.getByRole('button', { name: 'Save manually' }).click();
    await expect(purchasePage.getByRole('radio', { name: 'RFQ', exact: true })).toBeChecked();
    await expect(purchasePage.locator('div[name="partner_id"].o_field_invalid')).toHaveCount(0);

    await purchasePage.getByRole('button', { name: 'Confirm Order' }).click();
    await expect(purchasePage.getByRole('radio', { name: 'Purchase Order', exact: true })).toBeChecked();
    // Pat (Purchase: User) has no Inventory rights, so Odoo hides the Receipt button from her; the receipt is checked through the API below.

    const [order] = await api.searchRead<{ name: string; state: string }>(
      'purchase.order',
      [['partner_id', '=', vendorId]],
      ['name', 'state'],
    );
    expect(order.state).toBe('purchase');
    expect(await api.searchCount('purchase.order.line', [['product_id', '=', productId]])).toBe(1);
    const pickings = await api.searchRead<{ state: string }>('stock.picking', [['origin', '=', order.name]], ['state']);
    expect(pickings).toHaveLength(1);
    expect(pickings[0].state).toBe('assigned');

    expect(await onHand()).toBe(0);
    expect(await api.searchCount('account.move.line', [['product_id', '=', productId]])).toBe(0);
    expect(await api.searchCount('account.move', [['partner_id', '=', vendorId]])).toBe(0);
  });
});

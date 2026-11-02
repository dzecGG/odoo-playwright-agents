// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures';
import { PurchaseOrderPage } from '../../src/pages';

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
    const purchase = new PurchaseOrderPage(purchasePage);
    await purchase.gotoNewRfq();
    await purchase.addProduct(productName, 5);
    await purchase.save();

    // expect: the Vendor field is flagged invalid and nothing is saved.
    await expect(purchase.invalidField('partner_id')).toBeVisible();
    await expect(purchasePage).toHaveURL(/\/new$/);
    expect(await api.searchCount('purchase.order.line', [['product_id', '=', productId]])).toBe(0);

    // 2. Choose an API-created vendor, save, and click Confirm Order.
    await purchase.setVendor(vendorName);
    await purchase.save();
    await expect(purchase.statusStep('RFQ')).toBeChecked();
    await expect(purchase.invalidField('partner_id')).toHaveCount(0);

    await purchase.confirmOrder();
    await expect(purchase.statusStep('Purchase Order')).toBeChecked();
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

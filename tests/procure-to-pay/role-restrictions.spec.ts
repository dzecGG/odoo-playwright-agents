// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { OdooRpcError } from '../../src/api';
import { test, expect } from '../../src/fixtures';
import { InvoicePage, OdooPage, PurchaseOrderPage } from '../../src/pages';

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
    const home = new OdooPage(warehousePage);
    await home.openHomeMenuFromStart();
    await expect(home.homeMenuItem('Inventory')).toBeVisible();
    await expect(home.homeMenuItem('Purchase')).toHaveCount(0);
    await expect(home.homeMenuItem('Invoicing')).toHaveCount(0);
    await home.closeHomeMenu();

    // Direct navigation to the RFQ: access error dialog, or no Confirm Order button.
    const purchase = new PurchaseOrderPage(warehousePage);
    await purchase.gotoRfq(orderId);
    await expect(purchase.dialogOrForm).toBeVisible();
    await expect(purchase.button('Confirm Order')).toHaveCount(0);

    // Direct navigation to the vendor bill: access error dialog, or no Confirm button.
    const invoicePage = new InvoicePage(warehousePage);
    await invoicePage.gotoVendorBill(billId);
    await expect(invoicePage.dialogOrForm).toBeVisible();
    await expect(invoicePage.button('Confirm', { exact: true })).toHaveCount(0);

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

// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures';
import { InvoicePage, PickingPage } from '../../src/pages';

test.describe('Procure to Pay', () => {
  test('P2P-N3 Paid vendor bill cannot be paid twice and the receipt cannot be validated twice', async ({
    api,
    accountingPage,
    warehousePage,
  }) => {
    const uuid = randomUUID().slice(0, 8);
    const vendorName = `PW Vendor ${uuid}`;
    const productName = `PW Part ${uuid}`;

    // 1. SETUP (API, admin): vendor, product, confirmed PO of 10 units at 60.00, receipt validated, bill posted (636.00).
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

    const onHand = async (productId: number) => {
      const quants = await api.searchRead<{ quantity: number }>(
        'stock.quant',
        [['product_id', '=', productId], ['location_id', '=', stockLocationId]],
        ['quantity'],
      );
      return quants.reduce((sum, q) => sum + q.quantity, 0);
    };

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

    const orderId = await api.create('purchase.order', {
      partner_id: vendorId,
      order_line: [
        [0, 0, { product_id: productId, name: productName, product_qty: 10, price_unit: 60, tax_ids: [[6, 0, [purchaseTax.id]]] }],
      ],
    });
    await api.execute('purchase.order', 'button_confirm', [[orderId]]);
    const [order] = await api.read<{ name: string }>('purchase.order', [orderId], ['name']);

    const [receipt] = await api.searchRead<{ name: string }>('stock.picking', [['origin', '=', order.name]], ['name']);
    await api.execute('stock.picking', 'button_validate', [[receipt.id]]);

    await api.execute('purchase.order', 'action_create_invoice', [[orderId]]);
    const [billLink] = await api.read<{ invoice_ids: number[] }>('purchase.order', [orderId], ['invoice_ids']);
    const billId = billLink.invoice_ids[0];
    await api.write('account.move', [billId], { invoice_date: new Date().toISOString().slice(0, 10) });
    await api.execute('account.move', 'action_post', [[billId]]);

    expect(await onHand(productId)).toBe(10);
    const [bill] = await api.read<{ state: string; amount_total: number; amount_residual: number }>(
      'account.move',
      [billId],
      ['state', 'amount_total', 'amount_residual'],
    );
    expect(bill.state).toBe('posted');
    expect(bill.amount_total).toBe(636);
    expect(bill.amount_residual).toBe(636);

    // 2. ACCOUNTING (Ada Accounting): open the bill, click Pay, accept 636.00, Create Payment.
    const billPage = new InvoicePage(accountingPage);
    await billPage.gotoVendorBill(billId);
    await expect(billPage.statusStep('Posted')).toBeChecked();
    const paymentDialog = await billPage.pay();
    await expect(paymentDialog.amount).toHaveValue('636.00');
    await paymentDialog.createPayment();

    await expect(billPage.paidBadge).toBeVisible();

    const [paidBill] = await api.read<{ payment_state: string; amount_residual: number }>(
      'account.move',
      [billId],
      ['payment_state', 'amount_residual'],
    );
    expect(paidBill.payment_state).toBe('paid');
    expect(paidBill.amount_residual).toBe(0);

    // 3. ACCOUNTING (Ada): inspect the paid bill buttons. WAREHOUSE (Wes): open the Done receipt and check for a Validate button.
    await expect(billPage.payButton).toHaveCount(0);
    await expect(billPage.registerPaymentButton).toHaveCount(0);

    const payments = await api.searchRead<{ payment_type: string }>(
      'account.payment',
      [['partner_id', '=', vendorId]],
      ['payment_type'],
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].payment_type).toBe('outbound');

    const payable = await api.searchRead<{ balance: number }>(
      'account.move.line',
      [['partner_id', '=', vendorId], ['account_id.code', '=', '211000'], ['parent_state', '=', 'posted']],
      ['balance'],
    );
    expect(Math.round(payable.reduce((sum, l) => sum + l.balance, 0) * 100) / 100).toBe(0);

    const receiptPage = new PickingPage(warehousePage);
    await receiptPage.gotoReceipt(receipt.id);
    await expect(receiptPage.statusStep('Done')).toBeChecked();
    await expect(receiptPage.button('Validate')).toHaveCount(0);

    const [doneReceipt] = await api.read<{ state: string }>('stock.picking', [receipt.id], ['state']);
    expect(doneReceipt.state).toBe('done');
    expect(await onHand(productId)).toBe(10);
  });
});

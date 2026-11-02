// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures';

test.describe('Order to Cash', () => {
  test('O2C-N3 Fully paid invoice cannot be paid again', async ({ api, accountingPage }) => {
    const uuid = randomUUID().slice(0, 8);
    const customerName = `PW Customer ${uuid}`;
    const productName = `PW Widget ${uuid}`;

    // 1. SETUP (API, admin): customer, product (price 100.00), posted invoice of 10 units for 1,060.00.
    const [saleTax] = await api.searchRead<{ id: number }>(
      'account.tax',
      [['type_tax_use', '=', 'sale'], ['amount', '=', 6], ['amount_type', '=', 'percent']],
      ['id'],
      { limit: 1 },
    );
    const [category] = await api.searchRead<{ id: number }>('product.category', [['name', '=', 'Goods']], ['id'], { limit: 1 });

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

    const invoiceId = await api.create('account.move', {
      move_type: 'out_invoice',
      partner_id: customerId,
      invoice_line_ids: [
        [0, 0, { product_id: product.id, name: productName, quantity: 10, price_unit: 100, tax_ids: [[6, 0, [saleTax.id]]] }],
      ],
    });
    await api.execute('account.move', 'action_post', [[invoiceId]]);

    const [invoice] = await api.read<{ name: string; state: string; amount_total: number; amount_residual: number }>(
      'account.move',
      [invoiceId],
      ['name', 'state', 'amount_total', 'amount_residual'],
    );
    expect(invoice.state).toBe('posted');
    expect(invoice.amount_total).toBe(1060);
    expect(invoice.amount_residual).toBe(1060);

    // 2. ACCOUNTING (Ada Accounting): open the invoice, click Pay, accept the default amount, click Create Payment.
    await accountingPage.goto(`/odoo/action-account.action_move_out_invoice_type/${invoiceId}`);
    await expect(accountingPage.getByRole('radio', { name: 'Posted', exact: true })).toBeChecked();
    await accountingPage.getByRole('button', { name: 'Pay', exact: true }).click();
    const paymentDialog = accountingPage.getByRole('dialog');
    await expect(paymentDialog.getByRole('textbox', { name: 'Amount' })).toHaveValue('1,060.00');
    await paymentDialog.getByRole('button', { name: 'Create Payment' }).click();

    await expect(accountingPage.locator('span.text-bg-success').getByText('Paid', { exact: true })).toBeVisible();

    const [paidInvoice] = await api.read<{ payment_state: string; amount_residual: number }>(
      'account.move',
      [invoiceId],
      ['payment_state', 'amount_residual'],
    );
    expect(paidInvoice.payment_state).toBe('paid');
    expect(paidInvoice.amount_residual).toBe(0);

    // 3. ACCOUNTING (Ada Accounting): look at the paid invoice's header buttons.
    await expect(accountingPage.getByRole('button', { name: 'Pay', exact: true })).toHaveCount(0);
    await expect(accountingPage.getByRole('button', { name: 'Register Payment' })).toHaveCount(0);

    const receivable = await api.searchRead<{ balance: number }>(
      'account.move.line',
      [['partner_id', '=', customerId], ['account_id.code', '=', '121000'], ['parent_state', '=', 'posted']],
      ['balance'],
    );
    expect(Math.round(receivable.reduce((sum, l) => sum + l.balance, 0) * 100) / 100).toBe(0);
    expect(await api.searchCount('account.payment', [['partner_id', '=', customerId]])).toBe(1);
  });
});

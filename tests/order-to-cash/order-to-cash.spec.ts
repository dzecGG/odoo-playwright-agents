// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures';
import type { OdooClient } from '../../src/api';

type MoveLine = { account_id: [number, string]; debit: number; credit: number };

/** Journal items of a posted move, summed by account code. */
async function journalItems(api: OdooClient, moveId: number) {
  const lines = await api.searchRead<MoveLine>(
    'account.move.line',
    [['move_id', '=', moveId], ['parent_state', '=', 'posted']],
    ['account_id', 'debit', 'credit'],
  );
  const accounts = await api.read<{ code: string }>('account.account', [...new Set(lines.map((l) => l.account_id[0]))], ['code']);
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));
  const byAccount: Record<string, { debit: number; credit: number }> = {};
  for (const line of lines) {
    const code = codeById.get(line.account_id[0])!;
    const entry = (byAccount[code] ??= { debit: 0, credit: 0 });
    entry.debit = Math.round((entry.debit + line.debit) * 100) / 100;
    entry.credit = Math.round((entry.credit + line.credit) * 100) / 100;
  }
  return { byAccount, count: lines.length };
}

async function onHand(api: OdooClient, productId: number, locationId: number) {
  const quants = await api.searchRead<{ quantity: number; reserved_quantity: number }>(
    'stock.quant',
    [['product_id', '=', productId], ['location_id', '=', locationId]],
    ['quantity', 'reserved_quantity'],
  );
  return {
    quantity: quants.reduce((sum, q) => sum + q.quantity, 0),
    reserved: quants.reduce((sum, q) => sum + q.reserved_quantity, 0),
  };
}

test.describe('Order to Cash', () => {
  test('O2C-01 Quotation to sales order, delivery, customer invoice and payment @smoke', async ({
    api,
    salesPage,
    warehousePage,
    accountingPage,
  }) => {
    const uuid = randomUUID().slice(0, 8);
    const customerName = `PW Customer ${uuid}`;
    const productName = `PW Widget ${uuid}`;

    // 1. SETUP (API, admin). Create customer, storable product and 20 units on hand in WH/Stock.
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

    expect((await onHand(api, productId, stockLocationId)).quantity).toBe(20);
    expect(await api.searchCount('sale.order', [['partner_id', '=', customerId]])).toBe(0);
    expect(await api.searchCount('account.move', [['partner_id', '=', customerId]])).toBe(0);
    expect(await api.searchCount('account.payment', [['partner_id', '=', customerId]])).toBe(0);

    // 2. SALES (Sam Sales): create the quotation with 10 units at 100.00 and save.
    await salesPage.goto('/odoo/action-sale.action_quotations_with_onboarding/new');
    const customerField = salesPage.getByRole('combobox', { name: 'Customer' });
    await customerField.fill(customerName);
    await salesPage.getByRole('option', { name: customerName }).first().click();

    await salesPage.getByRole('button', { name: 'Add a product' }).click();
    await salesPage.getByRole('combobox', { name: 'Search a product' }).fill(productName);
    await salesPage.getByRole('option', { name: productName }).first().click();
    await salesPage.locator('td[name="product_uom_qty"] input').first().fill('10');
    await salesPage.locator('td[name="price_unit"] input').first().fill('100.00');
    await salesPage.getByRole('button', { name: 'Save manually' }).click();

    await expect(salesPage.getByRole('row', { name: /^Untaxed Amount:/ })).toContainText('$ 1,000.00');
    await expect(salesPage.getByRole('row', { name: /^Tax 6%:/ })).toContainText('$ 60.00');
    await expect(salesPage.getByRole('row', { name: /^Total:/ })).toContainText('$ 1,060.00');
    await expect(salesPage.getByRole('radio', { name: 'Quotation', exact: true })).toBeChecked();

    // Wait until Odoo has finished saving: the record exists in the database.
    await expect.poll(() => api.searchCount('sale.order', [['partner_id', '=', customerId]])).toBe(1);
    const [draftOrder] = await api.searchRead<{ id: number; name: string; state: string }>(
      'sale.order',
      [['partner_id', '=', customerId]],
      ['name', 'state'],
    );
    expect(draftOrder.state).toBe('draft');
    expect(await api.searchCount('account.move', [['partner_id', '=', customerId]])).toBe(0);

    // 3. SALES (Sam Sales): click Confirm.
    await salesPage.getByRole('button', { name: 'Confirm', exact: true }).click();

    await expect(salesPage.getByRole('radio', { name: 'Sales Order', exact: true })).toBeChecked();
    // Sam (Sales: User) has no Inventory rights, so Odoo hides the Delivery button from him; the delivery is checked through the API below.

    const [order] = await api.searchRead<{ id: number; name: string; state: string }>(
      'sale.order',
      [['partner_id', '=', customerId]],
      ['name', 'state'],
    );
    expect(order.state).toBe('sale');
    expect(order.name).toMatch(/^S/);

    const [delivery] = await api.searchRead<{ id: number; name: string; state: string }>(
      'stock.picking',
      [['origin', '=', order.name]],
      ['name', 'state'],
    );
    expect(delivery.name).toMatch(/^WH\/OUT\//);
    expect(delivery.state).toBe('assigned');

    const afterConfirm = await onHand(api, productId, stockLocationId);
    expect(afterConfirm.quantity).toBe(20);
    expect(afterConfirm.reserved).toBe(10);
    expect(await api.searchCount('account.move', [['partner_id', '=', customerId]])).toBe(0);

    // 4. WAREHOUSE (Wes Warehouse): open the delivery from Inventory > Deliveries and click Validate.
    await warehousePage.goto('/odoo/action-stock.action_picking_tree_outgoing');
    const pickingSearch = warehousePage.getByRole('searchbox');
    await pickingSearch.fill(order.name);
    await pickingSearch.press('Enter');
    await warehousePage.getByRole('row', { name: new RegExp(delivery.name) }).first().click();
    await expect(warehousePage.getByRole('radio', { name: 'Ready', exact: true })).toBeChecked();
    await expect(warehousePage.getByText(delivery.name).first()).toBeVisible();
    await warehousePage.getByRole('button', { name: 'Validate' }).click();

    await expect(warehousePage.getByRole('radio', { name: 'Done', exact: true })).toBeChecked();

    const [doneDelivery] = await api.read<{ state: string }>('stock.picking', [delivery.id], ['state']);
    expect(doneDelivery.state).toBe('done');
    expect((await onHand(api, productId, stockLocationId)).quantity).toBe(10);

    const moves = await api.searchRead<{ quantity: number; state: string; account_move_id: [number, string] | false }>(
      'stock.move',
      [['picking_id', '=', delivery.id], ['product_id', '=', productId]],
      ['quantity', 'state', 'account_move_id'],
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].quantity).toBe(10);
    expect(moves[0].state).toBe('done');
    // Limitation 1: periodic valuation, so the delivery posts no journal items.
    expect(moves[0].account_move_id).toBe(false);
    expect(await api.searchCount('account.move.line', [['product_id', '=', productId]])).toBe(0);

    const [deliveredLine] = await api.searchRead<{ qty_delivered: number }>(
      'sale.order.line',
      [['order_id', '=', order.id]],
      ['qty_delivered'],
    );
    expect(deliveredLine.qty_delivered).toBe(10);

    // 5. SALES creates the draft invoice; ACCOUNTING (Ada Accounting) confirms it.
    await salesPage.reload();
    await salesPage.getByRole('button', { name: 'Create Invoice' }).click();
    await salesPage.getByRole('button', { name: 'Create Draft', exact: true }).click();
    // Odoo opens the new draft invoice after "Create Draft".
    await expect(salesPage.getByRole('radio', { name: 'Draft', exact: true })).toBeChecked();
    await expect
      .poll(() => api.searchCount('account.move', [['partner_id', '=', customerId], ['move_type', '=', 'out_invoice'], ['state', '=', 'draft']]))
      .toBe(1);

    await accountingPage.goto('/odoo/action-account.action_move_out_invoice_type');
    const invoiceSearch = accountingPage.getByRole('searchbox');
    await invoiceSearch.fill(customerName);
    await invoiceSearch.press('Enter');
    await accountingPage.getByRole('row', { name: new RegExp(customerName) }).first().click();
    await accountingPage.getByRole('button', { name: 'Confirm', exact: true }).click();

    await expect(accountingPage.getByRole('radio', { name: 'Posted', exact: true })).toBeChecked();

    const [invoice] = await api.searchRead<{
      id: number;
      name: string;
      state: string;
      amount_total: number;
      amount_residual: number;
      payment_state: string;
      journal_id: [number, string];
    }>(
      'account.move',
      [['partner_id', '=', customerId], ['move_type', '=', 'out_invoice']],
      ['name', 'state', 'amount_total', 'amount_residual', 'payment_state', 'journal_id'],
    );
    expect(invoice.state).toBe('posted');
    expect(invoice.name).toMatch(/^INV\/\d{4}\/\d{5}$/);
    expect(invoice.journal_id[1]).toBe('Sales');
    expect(invoice.amount_total).toBe(1060);
    expect(invoice.amount_residual).toBe(1060);
    expect(invoice.payment_state).toBe('not_paid');

    const invoiceItems = await journalItems(api, invoice.id);
    expect(invoiceItems.count).toBe(3);
    expect(invoiceItems.byAccount).toEqual({
      '121000': { debit: 1060, credit: 0 },
      '400000': { debit: 0, credit: 1000 },
      '251000': { debit: 0, credit: 60 },
    });
    expect(invoiceItems.byAccount['500000']).toBeUndefined();
    expect((await onHand(api, productId, stockLocationId)).quantity).toBe(10);

    // 6. ACCOUNTING (Ada Accounting): register the payment of 1,060.00.
    await accountingPage.getByRole('button', { name: 'Pay', exact: true }).click();
    const paymentDialog = accountingPage.getByRole('dialog');
    await expect(paymentDialog.getByRole('combobox', { name: 'Journal' })).toHaveValue(/Bank/);
    await paymentDialog.getByRole('button', { name: 'Create Payment' }).click();

    await expect(accountingPage.locator('span.text-bg-success').getByText('Paid', { exact: true })).toBeVisible();

    const [paidInvoice] = await api.read<{ payment_state: string; amount_residual: number }>(
      'account.move',
      [invoice.id],
      ['payment_state', 'amount_residual'],
    );
    expect(paidInvoice.payment_state).toBe('paid');
    expect(paidInvoice.amount_residual).toBe(0);

    const [payment] = await api.searchRead<{
      payment_type: string;
      amount: number;
      state: string;
      move_id: [number, string];
    }>(
      'account.payment',
      [['partner_id', '=', customerId]],
      ['payment_type', 'amount', 'state', 'move_id'],
    );
    expect(payment.payment_type).toBe('inbound');
    expect(payment.amount).toBe(1060);
    expect(['paid', 'in_process']).toContain(payment.state);

    // The Bank journal's Manual Payment method has no account of its own, so the debit goes to 101403 Outstanding Receipts.
    const paymentItems = await journalItems(api, payment.move_id[0]);
    expect(paymentItems.byAccount).toEqual({
      '121000': { debit: 0, credit: 1060 },
      '101403': { debit: 1060, credit: 0 },
    });

    const receivable = await api.searchRead<{ balance: number }>(
      'account.move.line',
      [['partner_id', '=', customerId], ['account_id.code', '=', '121000'], ['parent_state', '=', 'posted']],
      ['balance'],
    );
    expect(Math.round(receivable.reduce((sum, l) => sum + l.balance, 0) * 100) / 100).toBe(0);
    expect((await onHand(api, productId, stockLocationId)).quantity).toBe(10);

    // 7. SALES (Sam Sales): reopen the sales order.
    await salesPage.goto(`/odoo/action-sale.action_quotations_with_onboarding/${order.id}`);
    await expect(salesPage.getByRole('button', { name: /Invoice/ }).filter({ hasText: '1' })).toBeVisible();

    const [finalOrder] = await api.read<{ invoice_status: string; delivery_status: string }>(
      'sale.order',
      [order.id],
      ['invoice_status', 'delivery_status'],
    );
    expect(finalOrder.invoice_status).toBe('invoiced');
    expect(finalOrder.delivery_status).toBe('full');
  });
});

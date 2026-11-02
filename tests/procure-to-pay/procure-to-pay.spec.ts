// spec: specs/odoo-cycles.plan.md
// seed: tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures';
import type { OdooClient } from '../../src/api';
import { InvoicePage, PickingPage, PurchaseOrderPage } from '../../src/pages';

type MoveLine = { account_id: [number, string]; debit: number; credit: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Posted journal items of one move, summed by account code. */
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
    entry.debit = round2(entry.debit + line.debit);
    entry.credit = round2(entry.credit + line.credit);
  }
  const totalDebit = round2(lines.reduce((sum, l) => sum + l.debit, 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + l.credit, 0));
  return { byAccount, count: lines.length, totalDebit, totalCredit };
}

async function onHand(api: OdooClient, productId: number, locationId: number) {
  const quants = await api.searchRead<{ quantity: number }>(
    'stock.quant',
    [['product_id', '=', productId], ['location_id', '=', locationId]],
    ['quantity'],
  );
  return quants.reduce((sum, q) => sum + q.quantity, 0);
}

/** Today in the Odoo UI date format (MM/DD/YYYY); the suite runs browser and Odoo users in UTC. */
function todayForOdoo() {
  return new Date().toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
}

test.describe('Procure to Pay', () => {
  test(
    'P2P-01 Purchase order to receipt, vendor bill and vendor payment @smoke',
    async ({ api, purchasePage, warehousePage, accountingPage }) => {
      const uuid = randomUUID().slice(0, 8);
      const vendorName = `PW Vendor ${uuid}`;
      const productName = `PW Part ${uuid}`;
      const vendorRef = `PW-REF-${uuid}`;

      // 1. SETUP (API, admin). Create vendor and storable product; check on-hand quantity.
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
      const [product] = await api.searchRead<{ id: number }>(
        'product.product',
        [['product_tmpl_id', '=', productTemplateId]],
        ['id'],
      );
      const productId = product.id;

      expect(await onHand(api, productId, stockLocationId)).toBe(0);
      expect(await api.searchCount('purchase.order', [['partner_id', '=', vendorId]])).toBe(0);
      expect(await api.searchCount('account.move', [['partner_id', '=', vendorId]])).toBe(0);
      expect(await api.searchCount('account.payment', [['partner_id', '=', vendorId]])).toBe(0);

      // 2. PURCHASING (Pat Purchase): open Requests for Quotation, click New, choose the vendor,
      //    add the product with quantity 10 and unit price 60.00, save.
      const purchase = new PurchaseOrderPage(purchasePage);
      await purchase.gotoRfqList();
      await purchase.clickNew();
      await purchase.setVendor(vendorName);
      await purchase.addProduct(productName, 10, '60.00');
      await purchase.save();

      await expect(purchase.totalsRow(/^Untaxed Amount:\s*\$ 600\.00/)).toBeVisible();
      await expect(purchase.totalsRow(/^Tax 6%:\s*\$ 36\.00/)).toBeVisible();
      await expect(purchase.totalsRow(/^Total:\s*\$ 636\.00/)).toBeVisible();
      await expect(purchase.statusStep('RFQ')).toBeChecked();

      // Wait until Odoo has finished saving: the record exists in the database.
      await expect
        .poll(() => api.searchCount('purchase.order', [['partner_id', '=', vendorId]]))
        .toBe(1);
      const [draftOrder] = await api.searchRead<{ id: number; name: string; state: string }>(
        'purchase.order',
        [['partner_id', '=', vendorId]],
        ['name', 'state'],
      );
      expect(draftOrder.state).toBe('draft');
      expect(await api.searchCount('account.move', [['partner_id', '=', vendorId]])).toBe(0);

      // 3. PURCHASING (Pat Purchase): click Confirm Order.
      await purchase.confirmOrder();
      await expect(purchase.statusStep('Purchase Order')).toBeChecked();

      const [order] = await api.searchRead<{ id: number; name: string; state: string; incoming_picking_count: number }>(
        'purchase.order',
        [['partner_id', '=', vendorId]],
        ['name', 'state', 'incoming_picking_count'],
      );
      expect(order.state).toBe('purchase');
      expect(order.name).toMatch(/^P/);
      expect(order.incoming_picking_count).toBe(1);

      // Purchasing neither receives goods nor enters bills: Odoo shows the Receipt and Receive buttons only to
      // Inventory users (stock.group_stock_user). Pat's step ends at the confirmed order; the receipt is
      // checked by the API here and in the UI by Wes in step 4.
      const [receipt] = await api.searchRead<{ id: number; name: string; state: string }>(
        'stock.picking',
        [['origin', '=', order.name]],
        ['name', 'state'],
      );
      expect(receipt.name).toMatch(/^WH\/IN\//);
      expect(receipt.state).toBe('assigned');
      expect(await onHand(api, productId, stockLocationId)).toBe(0);
      expect(await api.searchCount('account.move', [['partner_id', '=', vendorId]])).toBe(0);

      // 4. WAREHOUSE (Wes Warehouse): open Inventory > Operations > Receipts, search the PO reference,
      //    open the receipt, click Validate.
      const receipts = new PickingPage(warehousePage);
      await receipts.gotoReceipts();
      await receipts.search(order.name);
      await receipts.openListCell(receipt.name);
      await expect(receipts.statusStep('Ready')).toBeChecked();
      await receipts.validate();

      await expect(receipts.statusStep('Done')).toBeChecked();

      const [doneReceipt] = await api.read<{ state: string }>('stock.picking', [receipt.id], ['state']);
      expect(doneReceipt.state).toBe('done');
      expect(await onHand(api, productId, stockLocationId)).toBe(10);

      const [receivedLine] = await api.searchRead<{ qty_received: number }>(
        'purchase.order.line',
        [['order_id', '=', order.id]],
        ['qty_received'],
      );
      expect(receivedLine.qty_received).toBe(10);

      // Limitation 1: periodic valuation, so the receipt posts no journal items.
      const moves = await api.searchRead<{ quantity: number; state: string; account_move_id: number | false }>(
        'stock.move',
        [['picking_id', '=', receipt.id], ['product_id', '=', productId]],
        ['quantity', 'state', 'account_move_id'],
      );
      expect(moves).toHaveLength(1);
      expect(moves[0].quantity).toBe(10);
      expect(moves[0].state).toBe('done');
      expect(moves[0].account_move_id).toBe(false);
      expect(await api.searchCount('account.move.line', [['product_id', '=', productId]])).toBe(0);
      expect(await api.searchCount('account.move', [['partner_id', '=', vendorId]])).toBe(0);

      // 5. ACCOUNTING (Ada Accounting): open the purchase order, create the vendor bill from it ("Create Bills"
      //    on the order list; Invoicing rights already include read/write on purchase orders), fill Bill Date
      //    and the vendor reference, then click Confirm.
      const orders = new PurchaseOrderPage(accountingPage);
      await orders.gotoPurchaseOrders();
      await orders.search(order.name);
      await orders.createBillsFor(order.name);

      const billPage = new InvoicePage(accountingPage);
      await expect(billPage.statusStep('Draft')).toBeChecked();
      await billPage.fillBillDetails(vendorRef, todayForOdoo());

      await billPage.confirm();
      await expect(billPage.statusStep('Posted')).toBeChecked();

      const [bill] = await api.searchRead<{
        id: number;
        name: string;
        state: string;
        amount_total: number;
        amount_residual: number;
        payment_state: string;
        journal_id: [number, string];
      }>(
        'account.move',
        [['partner_id', '=', vendorId], ['move_type', '=', 'in_invoice']],
        ['name', 'state', 'amount_total', 'amount_residual', 'payment_state', 'journal_id'],
      );
      expect(bill.state).toBe('posted');
      expect(bill.name).toMatch(/^BILL\/\d{4}\//);
      expect(bill.journal_id[1]).toBe('Purchases');
      expect(bill.amount_total).toBe(636);
      expect(bill.amount_residual).toBe(636);
      expect(bill.payment_state).toBe('not_paid');

      const billItems = await journalItems(api, bill.id);
      expect(billItems.count).toBe(3);
      expect(billItems.byAccount).toEqual({
        '690000': { debit: 600, credit: 0 },
        '131000': { debit: 36, credit: 0 },
        '211000': { debit: 0, credit: 636 },
      });
      expect(billItems.totalDebit).toBe(636);
      expect(billItems.totalCredit).toBe(636);
      expect(await onHand(api, productId, stockLocationId)).toBe(10);

      // The bill was created from the order, so the order is 'Fully Billed' ('invoiced') and linked to this bill.
      const [billedOrder] = await api.read<{ invoice_status: string; invoice_ids: number[] }>(
        'purchase.order',
        [order.id],
        ['invoice_status', 'invoice_ids'],
      );
      expect(billedOrder.invoice_status).toBe('invoiced');
      expect(billedOrder.invoice_ids).toEqual([bill.id]);

      // 6. ACCOUNTING (Ada Accounting): click Pay; journal Bank, Manual Payment, amount 636.00; Create Payment.
      const paymentDialog = await billPage.pay();
      await expect(paymentDialog.journal).toHaveValue('Bank');
      await expect(paymentDialog.paymentMethod).toHaveValue('Manual Payment');
      await expect(paymentDialog.amount).toHaveValue('636.00');
      await paymentDialog.createPayment();

      await expect(billPage.paidRibbon).toBeVisible();

      const [paidBill] = await api.read<{ payment_state: string; amount_residual: number }>(
        'account.move',
        [bill.id],
        ['payment_state', 'amount_residual'],
      );
      expect(paidBill.payment_state).toBe('paid');
      expect(paidBill.amount_residual).toBe(0);

      const payments = await api.searchRead<{
        partner_id: [number, string];
        payment_type: string;
        amount: number;
        state: string;
        move_id: [number, string];
      }>('account.payment', [['partner_id', '=', vendorId]], ['partner_id', 'payment_type', 'amount', 'state', 'move_id']);
      expect(payments).toHaveLength(1);
      const [payment] = payments;
      expect(payment.partner_id[0]).toBe(vendorId);
      expect(payment.payment_type).toBe('outbound');
      expect(payment.amount).toBe(636);
      expect(payment.state).toBe('paid');

      // Limitation 3: pinned on the first run. The Bank "Manual Payment" line posts to 101404 Outstanding Payments.
      const paymentItems = await journalItems(api, payment.move_id[0]);
      expect(paymentItems.byAccount).toEqual({
        '211000': { debit: 636, credit: 0 },
        '101404': { debit: 0, credit: 636 },
      });

      const payable = await api.searchRead<{ balance: number }>(
        'account.move.line',
        [['partner_id', '=', vendorId], ['account_id.code', '=', '211000'], ['parent_state', '=', 'posted']],
        ['balance'],
      );
      expect(round2(payable.reduce((sum, l) => sum + l.balance, 0))).toBe(0);
      expect(await onHand(api, productId, stockLocationId)).toBe(10);
    },
  );
});

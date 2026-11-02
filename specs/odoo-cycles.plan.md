# Odoo 19 Community: Order to Cash and Procure to Pay

## Application Overview

End-to-end plan for Odoo Community 19.0 at http://localhost:8069 (database "playwright": Sales, Purchase, Inventory, Invoicing; no demo data; US chart of accounts, USD, company "My Company", 1-step receipts and 1-step delivery, taxes default to 6% sale / 6% purchase).

ROLES (src/roles.ts, standard rights, never admin; logged-in pages from the fixtures salesPage / purchasePage / warehousePage / accountingPage):
- sales = Sam Sales, group "Sales: User: Own Documents Only" (sales_team.group_sale_salesman)
- purchasing = Pat Purchase, group "Purchase: User" (purchase.group_purchase_user)
- warehouse = Wes Warehouse, group "Inventory: User" (stock.group_stock_user)
- accounting = Ada Accounting, group "Accounting: Invoicing" (account.group_account_invoice; Community 19 has only Invoicing and Administrator)

CONVENTIONS FOR ALL TESTS
- Each test creates its own records through the external API (api fixture = admin JSON-RPC, used for SETUP and CHECKS only, never for the business steps): a uniquely named customer or vendor (e.g. "PW Customer <uuid>"), a uniquely named storable product (type=consu, is_storable=true, category "Goods", list_price 100.00, standard_price 60.00, taxes_id = 6% sale tax, supplier_taxes_id = 6% purchase tax), and for O2C an initial stock of 20 units in WH/Stock set through stock.quant inventory_quantity + action_apply_inventory. No test reads or relies on another test's records; tests must run in parallel. The role users are created once by tests/setup/odoo.setup.ts, which is the only shared thing.
- Business steps are done in the UI by the role named in each step. Checks are done through the API on records filtered by the test's own product / partner / document name.
- Locators use roles, labels or stable attributes; no page.waitForTimeout. Page objects in src/pages, fixtures in src/fixtures, API client in src/api. Chromium only.
- Amounts: 10 units x 100.00 sale = 1,000.00 untaxed + 60.00 tax (6%) = 1,060.00. 10 units x 60.00 purchase = 600.00 untaxed + 36.00 tax (6%) = 636.00.
- Journal item check = read account.move.line (parent_state = posted) of the document's move, grouped by account code; compare account code, debit, credit. Order of lines is not checked.
- Journals: Sales INV (default account 400000 Product Sales), Purchases BILL, Bank BNK1 (default account 101401 Bank), Inventory Valuation STJ.
- Chart accounts used: 121000 Accounts Receivable; 211000 Accounts Payable; 400000 Product Sales; 251000 Tax Received (sale tax 6%); 131000 Tax Paid (purchase tax 6%); 690000 Miscellaneous Expenses (the category expense account for "Goods" purchases); 101401 Bank; 101403 Outstanding Receipts and 101404 Outstanding Payments (exist but the Manual Payment method lines have no payment account set, see payment notes).

ODOO COMMUNITY LIMITATIONS / FACTS TO RECORD IN THE README (do not fake):
1. Product categories in this database use periodic (manual) inventory valuation with standard cost. Delivery and receipt therefore post NO journal items (no Stock Interim, no 110100 Inventory Valuation, no 500000 Cost of Goods Sold at delivery). Tests must assert that the stock move creates zero account.move.line (stock.move.account_move_id/ account_move_ids empty and no new STJ journal entries for the product) and check on-hand quantity instead. The plan does not switch the category to automated valuation and does not fake COGS entries. If the implementer finds the 19.0 Community image does post valuation entries here, keep the assertion and mark the test test.fail() with a { type: 'bug' } annotation per CLAUDE.md.
2. Invoices post only the revenue / expense / tax / receivable / payable entries listed below.
3. Payment journal items: the Bank journal's "Manual Payment" lines have no outstanding account configured in this database. Expected default: payment moves between 121000 / 211000 and the account of the payment method line, falling back to the journal default account 101401 Bank. On the first run read payment.move_id lines and pin the actual pair in the page-object/expectation constant; the receivable/payable side (121000 credit 1,060.00 / 211000 debit 636.00) is fixed and must always be asserted. Do not loosen the assertion once pinned.
4. Odoo Community 19 has no app-grid home page; open apps through the "Home Menu" button in the navbar or by URL (/odoo/action-...). Menu items are role-dependent: sales sees Sales, purchasing sees Purchase, warehouse sees Inventory, accounting sees Invoicing/Accounting.

## Test Scenarios

### 1. Order to Cash

**Seed:** `tests/seed.spec.ts`

#### 1.1. O2C-01 Quotation to sales order, delivery, customer invoice and payment @smoke

**File:** `tests/order-to-cash/order-to-cash.spec.ts`

**Steps:**
  1. SETUP (API, admin). Create customer 'PW Customer <uuid>', storable product 'PW Widget <uuid>' (price 100.00, cost 60.00, 6% sale tax), and set on-hand quantity to 20 in WH/Stock. Check: stock.quant quantity for the product in WH/Stock location = 20.
    - expect: On-hand quantity is 20.00 before any step
    - expect: No sales order, invoice or payment exists for the customer
  2. SALES (Sam Sales, salesPage): open Sales > Orders > Quotations, click New, choose the customer, add a line with the product, quantity 10, unit price 100.00, and save.
    - expect: Quotation shows Untaxed Amount $ 1,000.00, Taxes $ 60.00, Total $ 1,060.00
    - expect: Status is Quotation (draft)
    - expect: No journal items posted (API: no account.move for the order)
  3. SALES (Sam Sales): click Confirm.
    - expect: Status becomes Sales Order, name has prefix S
    - expect: Sam does not see a Delivery smart button: Odoo shows it only to Inventory users (stock.group_stock_user), so Sam's step checks only the status; the delivery is checked through the API
    - expect: A Delivery picking WH/OUT/xxxxx exists in state Ready (API check, stock.picking with origin = order name, state 'assigned')
    - expect: Reserved quantity 10 of the 20 on hand; on-hand quantity still 20.00
    - expect: No journal items posted by confirmation
  4. WAREHOUSE (Wes Warehouse, warehousePage): open Inventory > Operations > Deliveries, search the order reference, open the delivery, check the delivery in the UI (its name WH/OUT/xxxxx and status Ready), then click Validate (set quantity done to 10 if needed; if an 'immediate transfer' dialog appears, click Apply).
    - expect: Before validating, Wes sees the delivery with status Ready
    - expect: Delivery state is Done
    - expect: On-hand quantity (API stock.quant, WH/Stock) is 10.00 (20 - 10)
    - expect: Customers location quant is not counted as on hand; stock.move for the product has quantity 10 and state done
    - expect: Ledger check: no account.move.line is created for this stock move (periodic valuation in Community config; limitation documented). Account 500000 Cost of Goods Sold and 110100 Inventory Valuation have no lines for this product
    - expect: Sales order delivered quantity = 10
  5. ACCOUNTING (Ada Accounting, accountingPage): open the sales order's invoice. Because Sam Sales does not have invoicing rights, Ada opens Invoicing > Customers > Invoices and uses the order, OR Sam clicks Create Invoice > Regular invoice and Ada continues from the draft invoice. Pick one flow and keep it: Sam (sales) clicks Create Invoice on the order and Create Draft in the wizard (Odoo 19 then opens the new draft invoice); Ada then opens Invoicing > Customers > Invoices, finds the draft for the customer, and clicks Confirm.
    - expect: Invoice state Posted, number INV/<year>/00001 pattern, journal Sales
    - expect: Amount Total $ 1,060.00, Amount Due $ 1,060.00, payment state 'Not Paid'
    - expect: Journal items (API account.move.line, posted): 121000 Accounts Receivable debit 1,060.00 credit 0.00; 400000 Product Sales debit 0.00 credit 1,000.00; 251000 Tax Received debit 0.00 credit 60.00
    - expect: Total debits equal total credits (1,060.00); exactly 3 lines excluding none
    - expect: No Cost of Goods Sold line (limitation 1)
    - expect: On-hand quantity unchanged at 10.00
  6. ACCOUNTING (Ada Accounting): on the posted invoice click Pay (Register Payment); leave journal Bank, method Manual Payment, amount 1,060.00, today's date; click Create Payment.
    - expect: Invoice shows the green 'Paid' ribbon, payment state paid, amount due 0.00
    - expect: Payment record (account.payment) exists: partner = customer, type inbound, amount 1,060.00, state paid/in process
    - expect: Payment journal items: 121000 Accounts Receivable debit 0.00 credit 1,060.00; counterpart on the Bank payment-method account (101401 Bank, or 101403 Outstanding Receipts if configured, see note 3) debit 1,060.00 credit 0.00
    - expect: Customer receivable balance (sum of 121000 lines for the partner) is 0.00 (invoice and payment reconciled)
    - expect: On-hand quantity still 10.00
  7. SALES (Sam Sales): reopen the sales order.
    - expect: Order invoice status is 'Fully Invoiced', delivery status Fully delivered, Invoices smart button shows 1

#### 1.2. O2C-N1 Quotation cannot be saved or confirmed without a customer

**File:** `tests/order-to-cash/quotation-validation.spec.ts`

**Steps:**
  1. SETUP (API): create a storable product (stock 20). SALES (Sam Sales): open Sales > Orders > Quotations > New, leave Customer empty, add the product with quantity 5, and click the save (cloud) icon.
    - expect: A validation error / red-highlighted 'Customer' field is shown (invalid field notification, record not saved)
    - expect: API: no sale.order exists for the product (search_count of sale.order.line for the product = 0)
  2. Fill the customer (API-created) and save, then click Confirm.
    - expect: Order is confirmed, one delivery created
    - expect: Stock on hand is still 20.00 and no journal items exist

#### 1.3. O2C-N2 Sales user cannot post invoices or move stock (role separation)

**File:** `tests/order-to-cash/role-restrictions.spec.ts`

**Steps:**
  1. SETUP (API): create customer, product with stock 20 and a confirmed sales order of 10 units (API action_confirm as admin, setup only); then produce a draft invoice via the sale order's _create_invoices (admin, setup only).
    - expect: Draft invoice and a Ready delivery exist
  2. SALES (Sam Sales, salesPage): open the Home Menu and look for Inventory, Purchase and Invoicing apps; navigate directly to the draft invoice URL (/odoo/action-account.action_move_out_invoice_type/<id>) and the delivery picking URL.
    - expect: Inventory and Purchase are not in the Home Menu; the Home Menu lists Sales
    - expect: The draft invoice and delivery cannot be edited or posted by the sales user: either an Access Error dialog is shown or no Confirm / Validate button is available
    - expect: API as sales (apiAs('sales')) calling account.move action_post on the invoice raises an AccessError; the sales user's attempt to validate the delivery over the API is its own scenario, O2C-N2b
    - expect: Invoice remains draft, delivery remains Ready, on-hand quantity still 20.00

#### 1.3b. O2C-N2b Sales user cannot validate a delivery through the API

**File:** `tests/order-to-cash/role-restrictions.spec.ts`

**Known finding:** this scenario is expected to fail today and is marked `test.fail()` with the annotation `{ type: 'bug', description: 'Segregation of duties: a Sales: User can validate a delivery through the external API (stock.picking.button_validate), although the UI hides it' }`. Reproduced: Sam's call returns true and the delivery goes to Done. Cause: `sale_stock/security/ir.model.access.csv` gives Sales: User read, write and create on `stock.picking`, while the UI hides Inventory and the Validate button from Sam. The business rule is that only the warehouse ships goods, so the assertion stays. When Odoo closes the gap, the test will pass unexpectedly: remove `test.fail()` then.

**Steps:**
  1. SETUP (API, admin): customer, product with stock 20, confirmed sales order of 10 units.
    - expect: A delivery exists in state Ready
  2. SALES (Sam Sales, API as sales): call stock.picking button_validate on the delivery.
    - expect: The call raises an AccessError
    - expect: The delivery remains Ready

#### 1.4. O2C-N3 Fully paid invoice cannot be paid again

**File:** `tests/order-to-cash/double-payment.spec.ts`

**Steps:**
  1. SETUP (API, admin): customer, product (price 100.00), posted invoice of 10 units for 1,060.00 (create account.move out_invoice with line, action_post). Do not use the UI for setup.
    - expect: Invoice posted with amount due 1,060.00
  2. ACCOUNTING (Ada Accounting): open the invoice, click Pay, accept the default amount 1,060.00, click Create Payment.
    - expect: Invoice is Paid, amount due 0.00
  3. ACCOUNTING (Ada Accounting): look at the paid invoice's header buttons.
    - expect: No 'Pay' / 'Register Payment' button is shown
    - expect: API check: sum of 121000 lines for the partner is 0.00 and the number of account.payment records for the partner is exactly 1

### 2. Procure to Pay

**Seed:** `tests/seed.spec.ts`

#### 2.1. P2P-01 Purchase order to receipt, vendor bill and vendor payment @smoke

**File:** `tests/procure-to-pay/procure-to-pay.spec.ts`

**Steps:**
  1. SETUP (API, admin). Create vendor 'PW Vendor <uuid>' and storable product 'PW Part <uuid>' (cost 60.00, 6% purchase tax, no vendor pricelist needed). Check on-hand quantity.
    - expect: On-hand quantity is 0 (no quant) before any step
    - expect: No purchase order, bill or payment exists for the vendor
  2. PURCHASING (Pat Purchase, purchasePage): open Purchase > Orders > Requests for Quotation, click New, choose the vendor, add the product with quantity 10 and unit price 60.00, save.
    - expect: RFQ shows Untaxed Amount $ 600.00, Taxes $ 36.00, Total $ 636.00
    - expect: Status RFQ
    - expect: No journal items posted
  3. PURCHASING (Pat Purchase): click Confirm Order.
    - expect: Status Purchase Order, name prefix P
    - expect: Pat has no Receipt or Receive button and no way to bill the order: Odoo shows those only to Inventory users (stock.group_stock_user). Segregation of duties, so Pat's step ends at the confirmed order and nothing else is checked in Pat's UI
    - expect: Receipt WH/IN/xxxxx exists in state Ready and the order's incoming picking count is 1 (API check)
    - expect: On-hand quantity still 0 (nothing received yet)
    - expect: No journal items posted by confirmation
  4. WAREHOUSE (Wes Warehouse, warehousePage): open Inventory > Operations > Receipts, search the PO reference, open the receipt, check it is Ready, click Validate (quantity 10).
    - expect: Receipt shows state Ready before validation (Wes checks the receipt in the UI)
    - expect: Receipt state Done
    - expect: On-hand quantity (stock.quant, WH/Stock) is 10.00 (0 + 10)
    - expect: PO line received quantity = 10
    - expect: Ledger check: no account.move.line created for the receipt (periodic valuation, limitation 1); no lines on 110100 Inventory Valuation or Stock Interim for this product
  5. ACCOUNTING (Ada Accounting, accountingPage): Ada opens the purchase order list (/odoo/action-purchase.purchase_form_action; Invoicing rights already include read/write on purchase orders, no extra group), selects the PO and clicks Create Bills, which makes the draft bill linked to the PO (Odoo 19 has no Create Bill button on the PO form, and the bill form's Auto-Complete needs Purchase: User, which Ada does not have). Fill Bill Date (today) and the vendor reference 'PW-REF-<uuid>', then Ada clicks Confirm.
    - expect: Bill state Posted, journal Purchases, number BILL/<year>/..
    - expect: Amount Total $ 636.00, payment state Not Paid
    - expect: Journal items: 690000 Miscellaneous Expenses debit 600.00 credit 0.00; 131000 Tax Paid debit 36.00 credit 0.00; 211000 Accounts Payable debit 0.00 credit 636.00
    - expect: Total debits = total credits = 636.00
    - expect: On-hand quantity unchanged at 10.00
    - expect: PO invoice status 'Fully Billed' (invoiced) and the PO's bills are exactly this bill
  6. ACCOUNTING (Ada Accounting): on the posted bill click Pay; journal Bank, method Manual Payment, amount 636.00; click Create Payment.
    - expect: Bill shows the 'Paid' ribbon, amount due 0.00
    - expect: Payment record: partner = vendor, type outbound, amount 636.00
    - expect: Payment journal items: 211000 Accounts Payable debit 636.00 credit 0.00; counterpart on Bank payment-method account (101401 Bank, or 101404 Outstanding Payments if configured, see note 3) debit 0.00 credit 636.00
    - expect: Vendor payable balance (sum of 211000 lines for the vendor) is 0.00
    - expect: On-hand quantity still 10.00

#### 2.2. P2P-N1 Purchase order cannot be saved without a vendor

**File:** `tests/procure-to-pay/rfq-validation.spec.ts`

**Steps:**
  1. SETUP (API): create a product. PURCHASING (Pat Purchase): Purchase > Orders > Requests for Quotation > New, leave Vendor empty, add the product with quantity 5, click the save icon.
    - expect: Validation error, the Vendor field is highlighted as invalid, record not saved
    - expect: API: no purchase.order.line exists for the product
  2. Choose an API-created vendor, save, and click Confirm Order.
    - expect: PO is confirmed with one receipt in Ready
    - expect: On-hand quantity remains 0 and no journal items exist

#### 2.3. P2P-N2 Warehouse user cannot confirm purchase orders or post vendor bills (role separation)

**File:** `tests/procure-to-pay/role-restrictions.spec.ts`

**Steps:**
  1. SETUP (API, admin): vendor, product, a draft RFQ of 10 units at 60.00 and a draft vendor bill.
    - expect: RFQ in draft, bill in draft
  2. WAREHOUSE (Wes Warehouse, warehousePage): open the Home Menu, then navigate directly to the RFQ and the bill by URL.
    - expect: Purchase and Invoicing apps are not in the Home Menu; Inventory is
    - expect: The RFQ and bill cannot be opened for edit or confirmed: an Access Error is shown or the Confirm button is absent
    - expect: API as warehouse (apiAs('warehouse')): purchase.order button_confirm and account.move action_post raise AccessError
    - expect: RFQ stays draft, bill stays draft, no stock and no journal items created

#### 2.4. P2P-N3 Paid vendor bill cannot be paid twice and the receipt cannot be validated twice

**File:** `tests/procure-to-pay/double-payment.spec.ts`

**Steps:**
  1. SETUP (API, admin): vendor, product, confirmed PO of 10 units at 60.00, receipt validated via API (stock 10), bill created and posted via API (636.00).
    - expect: On-hand quantity 10.00, bill posted with amount due 636.00
  2. ACCOUNTING (Ada Accounting): open the bill, click Pay, accept 636.00, Create Payment.
    - expect: Bill Paid, amount due 0.00
  3. ACCOUNTING (Ada): inspect the paid bill buttons. WAREHOUSE (Wes): open the Done receipt and check for a Validate button.
    - expect: No Pay / Register Payment button on the paid bill; exactly 1 outbound account.payment exists for the vendor and 211000 balance for the vendor is 0.00
    - expect: The Done receipt has no Validate button and its state stays Done; on-hand quantity stays 10.00 (not 20.00)

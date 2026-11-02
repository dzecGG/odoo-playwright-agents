# Prompt log

Every prompt given to an agent while building this suite, in order.

## 1. Build the foundation

- Milestone: 4
- Agent: Claude Code (main session)
- Prompt:
  > Read CLAUDE.md. Build the foundation only, no cycle tests yet:
  > 1. docker/compose.yml that starts Odoo and PostgreSQL as the brief describes.
  > 2. .env.example, a local .env, and playwright.config.ts.
  > 3. An API client for Odoo's external API in src/api.
  > 4. A setup project that creates the database if it's missing, creates one user per role with the right access rights, and saves each user's login for the tests.
  > 5. Fixtures in src/fixtures that give a test the API client and a logged-in page per role.
  > 6. Replace tests/seed.spec.ts with a test that uses the fixtures and ends logged in as the sales user on Odoo's home screen. The planner agent starts from it.
  >
  > Start Odoo, then run npx tsc --noEmit and npx playwright test --project=setup until both pass. Run the setup a second time to prove it works on an Odoo it has already set up. Then tell me what you built and anything you couldn't do.
- What happened: Built docker/compose.yml (Odoo 19.0 and Postgres 17, project name odoo-playwright, health checks, own volumes, port 8069), .env.example and a local .env (US chart of accounts; .env added to .gitignore), playwright.config.ts (a setup project plus Chromium, on UTC), src/api/odoo-client.ts, tests/setup/odoo.setup.ts and src/fixtures/index.ts, and a new seed test. The setup creates the database without demo data, installs Sales, Purchase, Inventory and Invoicing, creates four role users, resets their rights on every run, and saves each login. It chose the narrowest standard rights: Sales "User: Own Documents Only" and accounting "Invoicing". It used Odoo's older external API, which Odoo 19 deprecates, because the newer one can't create databases. The seed ends on the home screen as the sales user. My Step 3 checks: [results].
- What I corrected, and why: Accepted Invoicing rights for accounting (narrowest role that does the job) and the older API (deprecated in Odoo 19, but the version is pinned; will note it in the README). Asked for two changes in entry 2: the accounting user bills the sales order, as in NetSuite; and the seed's Home Menu locator, because a title usually counts as an accessible name.

## 2. Fix: who bills the order, and the Home Menu locator

- Milestone: 4
- Agent: Claude Code (main session)
- Prompt:
  > Two decisions:
  > 1. The accounting user creates the invoice from the sales order, as an accounts receivable clerk would. Give the accounting user the smallest extra access right that allows it, and tell me which one you added.
  > 2. The seed finds the app-menu button by its title. A title usually counts as a button's accessible name, so check whether getByRole('button', { name: 'Home Menu' }) finds it, and use that if it does.
  > Run npx tsc --noEmit and npx playwright test --project=setup when done.
- What happened: [which right it added for billing; whether the role locator worked]
- What I corrected, and why: [None, or what you asked for next]

## 3. Test plan for both cycles

- Milestone: 5
- Agent: playwright-test-planner
- Prompt:
  > @agent-playwright-test-planner Create a test plan for the Order to Cash and Procure to Pay cycles described in CLAUDE.md.
  > - Seed file: tests/seed.spec.ts
  > - Test plan: specs/odoo-cycles.plan.md
  > For every step, name the role that does it. For every step that posts accounting entries, list the expected journal items (account, debit, credit) for the amounts in the scenario. Keep to the two cycles, with at most 3 negative scenarios per cycle.
- What happened: Wrote specs/odoo-cycles.plan.md with 8 scenarios: a full cycle and 3 negative scenarios for each of Order to Cash and Procure to Pay. [Whether the planner used the browser; anything notable in the plan]
- What I corrected, and why: [your review findings from the Milestone 5 checklist, or None]

## 4. Generate all scenarios

- Milestone: 6
- Agent: Claude Code, calling playwright-test-generator for each scenario
- Prompt:
  > For each scenario in specs/odoo-cycles.plan.md, one after another, not in parallel, use the playwright-test-generator agent to generate its test. Save each test as tests/<cycle>/<scenario-name>.spec.ts. Use the fixtures in src/fixtures, with the role page the plan names for each step. Don't fix failing tests yet. When every scenario is generated, run npx playwright test and tell me which tests pass and which fail.
- What happened: All 8 tests generated. First full run: 1 passed (P2P-N2), 7 failed, in 16.8 minutes. Every generator subagent said it didn't run or check its test, and several said their locators were guesses. Sample failures: P2P-01 waited for a "Taxes:" row on the RFQ form that never appeared; P2P-N1 couldn't find a "Receipt" button after Confirm Order; P2P-N3's API setup call was rejected by Odoo before any UI step.
- What I corrected, and why: P2P-N2's only check accepts either a dialog or a form, so it passes whatever Odoo does (entry 5). Paused before healing to find out why the generator didn't use the browser (entry 6).

## 5. Fix: P2P-N2 accepts either outcome

- Milestone: 6
- Agent: Claude Code (main session)
- Prompt:
  > In the P2P-N2 role restrictions test, the check accepts either a dialog or a form, so it passes whatever Odoo does. Decide from Odoo's actual behaviour what the restricted user should see, and assert only that.
- What happened: [what it now asserts, and whether the test passes]
- What I corrected, and why: [None, or what you asked for next]

## 6. Regenerate P2P-01 using the browser

- Milestone: 6
- Agent: playwright-test-generator
- Prompt:
  > @agent-playwright-test-generator Regenerate scenario P2P-01 from specs/odoo-cycles.plan.md, replacing tests/procure-to-pay/procure-to-pay.spec.ts. Run every step in the browser before you write it, and don't guess any locator. If you can't reach the browser, stop and tell me why.
- What happened: [Whether /mcp showed playwright-test connected beforehand.] The run looked green ("4 passed"), but only because the generator wrapped the whole test in test.fail(), which passes a test that fails anywhere. Without it, the test fails at step 2: after "Save manually", the API finds no purchase order (spec line 133), probably because the test reads it before the save finishes. Steps 3 to 6 never ran. The generator also claimed the purchasing user has no Receipt button and the accounting user can't find the purchase order; neither is reproduced. A Chromium left open by the generator's session locked test-results/.playwright-artifacts-1, so the next npx playwright test run hung. npx tsc --noEmit passes, and the 3 setup tests pass.
- What I corrected, and why: Rejected the blanket test.fail(). The brief allows it only for an Odoo bug I've reproduced, and it was hiding a broken test step. Sent the rules in entry 7.

## 7. Heal P2P-01, with rules

- Milestone: 7
- Agent: playwright-test-healer
- Prompt:
  > 1. Yes, stop the leftover Chromium.
  > 2. For the Procure to Pay test, use the healer with these rules:
  > - Remove test.fail() from the test completely. The brief allows test.fail() only for an Odoo bug I have reproduced, and none has been yet.
  > - Fix step 2: wait until Odoo has finished saving the purchase order before reading it through the API.
  > - Then run the test and fix test problems step by step. Each step must use the role the plan names for it. If the plan has the purchasing user receiving the goods, tell me, because receipts belong to the warehouse role.
  > - The accounting user creates the vendor bill, the same decision as for Order to Cash. If Odoo's Invoicing rights can't open the purchase order, add the smallest extra right that allows it, and tell me which one.
  > - If a step fails because of access rights, stop and show me the exact error. Don't mark anything as a bug.
  > Stop after 3 attempts on any one step.
- What happened: [result]
- What I corrected, and why: [result]

## 7. Heal P2P-01, with rules

- Milestone: 7
- Agent: playwright-test-healer
- Prompt:
  > 1. Yes, stop the leftover Chromium.
  > 2. For the Procure to Pay test, use the healer with these rules:
  > - Remove test.fail() from the test completely. The brief allows test.fail() only for an Odoo bug I have reproduced, and none has been yet.
  > - Fix step 2: wait until Odoo has finished saving the purchase order before reading it through the API.
  > - Then run the test and fix test problems step by step. Each step must use the role the plan names for it. If the plan has the purchasing user receiving the goods, tell me, because receipts belong to the warehouse role.
  > - The accounting user creates the vendor bill, the same decision as for Order to Cash. If Odoo's Invoicing rights can't open the purchase order, add the smallest extra right that allows it, and tell me which one.
  > - If a step fails because of access rights, stop and show me the exact error. Don't mark anything as a bug.
  > Stop after 3 attempts on any one step.
- What happened: The healer had no shell and ran nothing itself; Claude Code reran the test to check its report. The healer removed the blanket test.fail() and fixed step 2 by waiting for the save. npx tsc --noEmit passes. Steps 1 and 2 pass, and every ledger and stock check in steps 3 to 6 passes, including the bill's and the payment's journal items (the payment posts through 101404 Outstanding Payments). Two access-rights failures remain. Pat (Purchase: User) sees no Receipt or Create Bill button after confirming the order. Ada (Invoicing) can't select the purchase order on the vendor bill, so the order stays "to invoice". The plan correctly has Wes, the warehouse user, receiving the goods.
- What I corrected, and why: Kept Pat's rights as they are and asked for the test to change instead. Purchasing doesn't receive goods or enter bills; that's standard segregation of duties, as in NetSuite. Asked for the smallest extra right that lets Ada link the bill to the purchase order (entry 8). Neither failure is an Odoo bug.

## 8. Decide the access rights for Pat and Ada

- Milestone: 7
- Agent: Claude Code (main session)
- Prompt:
  > 1. Ada: yes. Find the smallest standard group that lets her open purchase orders and link them to a vendor bill. Confirm she stays a non-administrator, and tell me exactly what else that group lets her do.
  > 2. Pat: don't add rights. Purchasing doesn't receive goods or enter bills here, the same segregation of duties as in NetSuite. First confirm in Odoo's code which groups show the Receipt and Create Bill buttons. Then update the plan and the test so Pat's step checks only what Pat needs, that the order is confirmed, and the receipt is checked by Wes, the warehouse user, who does that step.
  > Then run npx tsc --noEmit and the test twice in a row, and show me the results.
- What happened: Claude Code did this work itself, because the healer had no shell. Ada needed no extra group: Invoicing (account.group_account_invoice) already reads and edits purchase orders and their lines, but can't create or delete them. Her earlier "No records" came from the bill form's Auto-Complete field, which needs Purchase: User. Odoo 19 has no Create Bill button on the order form; the route is the Purchase Orders list, select the order, then Create Bills. A live check as Ada made a draft bill for 636.00 linked to the order, and the order became "invoiced". She stays a non-administrator, which the setup checks. Pat: Odoo's code confirms the Receipt and Receive buttons need Inventory rights (stock.group_stock_user), so Pat's step now checks only that the order is confirmed, the API checks the receipt exists and is Ready, and Wes checks the receipt in the UI before validating it. Steps 3 to 5 of P2P-01 in specs/odoo-cycles.plan.md were updated to match. npx tsc --noEmit passes, and procure-to-pay.spec.ts passed twice in a row (9.6 s and 9.5 s) with no test.fail(), soft assertions or bug annotations. The other three Procure to Pay specs weren't run.
- What I corrected, and why: None. Accepted not adding Purchase: User for Ada, because it would also let her create, confirm and cancel purchase orders, which breaks segregation of duties.
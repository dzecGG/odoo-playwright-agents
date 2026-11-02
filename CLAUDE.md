# Brief: Odoo test suite, built by agents

Claude Code and the Playwright agents write all code in this repo. I review it. Never ask me to edit code by hand.

## Goal

A Playwright + TypeScript suite that tests Odoo's Order to Cash and Procure to Pay cycles end to end, and checks the accounting entries each step posts.

## The app

- Odoo Community 19.0 (official Docker image `odoo:19.0`) with PostgreSQL, started from `docker/compose.yml`, on http://localhost:8069. The compose file sets the project name `odoo-playwright`, so it never mixes with other Docker projects on this computer.
- The suite creates its own database, with the Sales, Purchase, Inventory and Invoicing apps and no demo data. No manual steps in the browser, ever.
- It must work on a brand-new Odoo and on one it has already set up.
- Settings come from `.env`. Keep `.env.example` up to date; never commit `.env`.

## Scope

1. Order to Cash: quotation confirmed as a sales order, delivery, customer invoice, customer payment.
2. Procure to Pay: purchase order, receipt, vendor bill, vendor payment.
3. Each step is done in the UI by a separate user with Odoo's standard access rights for that job: sales, purchasing, warehouse, accounting. Not by the administrator.
4. After every step that posts accounting entries, check the journal items (accounts, debits, credits) against expected values. After every stock move, check the on-hand quantity.
5. Out of scope: manufacturing, POS, eCommerce, HR, reports, printing, email.

## Rules

- Tests create their own records (users, customers, vendors, products) through Odoo's external API. No test depends on another test or on shared records; tests can run in parallel.
- Use the API for setup and checks, and the UI for the business steps under test.
- Page objects in `src/pages`, fixtures in `src/fixtures`, the API client in `src/api`.
- Locators use roles, labels or stable attributes. Never use `page.waitForTimeout`.
- Chromium only. Tag the two cycle tests `@smoke`.
- Never weaken, remove or skip an assertion to make a test pass. If Odoo behaves wrongly, keep the assertion, mark the test `test.fail()` and add an annotation `{ type: 'bug', description: '...' }`.
- If Odoo Community can't do something in scope (for example, post stock moves to the ledger), say so in the README and test what it can do. Never fake it.
- Run `npx tsc --noEmit` and the affected tests before saying a task is done.

## Definition of done

- `npx playwright test` passes on a brand-new Odoo, and again on a second run.
- GitHub Actions runs the suite against a brand-new Odoo from `docker/compose.yml` on push, pull request and nightly, and publishes the HTML report to GitHub Pages.
- The README explains how to run the suite and how it was built.
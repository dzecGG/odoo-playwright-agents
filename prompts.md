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
- What happened: Built docker/compose.yml (Odoo 19.0 and Postgres 17, project name odoo-playwright, health checks, own volumes, port 8069), .env.example and a local .env (US chart of accounts; .env added to .gitignore), playwright.config.ts (a setup project plus Chromium, on UTC), src/api/odoo-client.ts, tests/setup/odoo.setup.ts and src/fixtures/index.ts, and a new seed test. The setup creates the database without demo data, installs Sales, Purchase, Inventory and Invoicing, creates four role users, resets their rights on every run, and saves each login. It chose the narrowest standard rights: Sales "User: Own Documents Only" and accounting "Invoicing". It used Odoo's older external API, which Odoo 19 deprecates, because the newer one can't create databases. The seed ends on the home screen as the sales user.
- What I corrected, and why: Accepted Invoicing rights for accounting (narrowest role that does the job) and the older API (deprecated in Odoo 19, but the version is pinned; will note it in the README). Asked for two changes in entry 2: the accounting user bills the sales order, as in NetSuite; and the seed's Home Menu locator, because a title usually counts as an accessible name.
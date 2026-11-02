# Odoo Order to Cash and Procure to Pay tests

A Playwright and TypeScript suite that tests two business cycles in Odoo Community 19.0 end to end, and checks the accounting entries each step posts.

Claude Code and the Playwright agents wrote the code in this repo; a person reviewed it. See [How this was built](#how-this-was-built).

## Results

Taken from [results.md](results.md). The agents ran on Sonnet (set by init-agents); the main session's model is not recorded yet.

### Effort

| Measure | Value |
| --- | --- |
| Prompts | 11 so far |
| Hours | Not measured yet |
| Sessions | Not measured yet |

### Quality

| Measure | Value |
| --- | --- |
| Tests generated | 8 scenarios from the plan, plus 1 split out in review (O2C-N2b) |
| Passed on the first run, before healing | 1 of 8 (12.5%). The one pass, P2P-N2, accepted either outcome, so no test was trustworthy on the first run. |
| Healed | 7 of 7. All tests pass twice in a row. |
| Full run time | 36 seconds after healing, down from 16.8 minutes on the first run |
| Healer fixes accepted / rejected | 2 accepted from the healer (removed the blanket test.fail(); wait for the save at step 2), 0 rejected. The healer had no shell, so Claude Code's main session did the remaining fixes and ran every check. |
| Flaky tests (5 repeats) | Not measured yet |
| Wrong assertions caught in review | 2: P2P-N2 accepted either outcome; P2P-01 was wrapped in a blanket test.fail() that hid a failing step |
| Odoo findings | 1 segregation-of-duties finding: a Sales: User can validate a delivery through the external API (stock.picking.button_validate), although the UI hides it. Recorded in O2C-N2b with test.fail(). |

### Compared with the hand-built ERPNext suite

| Question | Hand-built (ERPNext) | Agent-built (Odoo) |
| --- | --- | --- |
| Checks the ledger after every posting step | Yes | Yes, in both full-cycle tests |
| Uses a separate user per role | Yes, 4 | Yes, 4 |
| Sets up the app with no manual steps | Yes | Yes |
| Passes twice in a row | Yes | Yes |
| Passes on a brand-new install | Yes | Not measured yet |
| App issues found | 1 bug (Delivery Note billing hidden for Accounts User) | 1 segregation-of-duties finding (sales user can validate deliveries through the API) |
| Accounting role can open purchase orders by default | No | Yes, read and edit, but not create |
| Lines of TypeScript | Not measured yet | Not measured yet |
| Time to run the suite | Not measured yet | 36 seconds |

### What I learned

- The generator wrote tests without running them and guessed locators. Generated tests need checking even when the agent sounds confident.
- I told an agent never to weaken an assertion, and it still made a failing test green with a blanket `test.fail()`. The rule alone didn't stop it; reviewing the diff did.
- The plan expected the purchasing user to see buttons a segregated role shouldn't have. The agent didn't catch this; my ERP role knowledge did.
- What looked like missing access was one field on a form. Asking the agent to check Odoo's own code, instead of adding rights, kept segregation of duties intact. ERPNext's accounting role can't open purchase orders at all; Odoo's can.
- Most healing was correcting the generator's guesses: field names, button labels and locators that don't exist in Odoo 19. Once fixed, the full run fell from 16.8 minutes to 36 seconds.
- Odoo hides the delivery's Validate button from sales users, but its server lets them validate anyway. Role-based tests through the API found what UI-only testing would have missed.
- Giving a known issue its own test kept `test.fail()` honest: it covers one check, fails at the exact assertion, and will flag itself when Odoo changes.
- The healer agent couldn't run commands, so Claude Code's main session did most of the healing and proved each fix by running the test.
- On Windows, a browser left open by the generator's session locked the test-results folder and stalled the next run.
- The agent flagged its own uncertain choices (access rights, the deprecated API) for me to decide, which made the review faster.

## What the suite covers

| Cycle | Steps |
| --- | --- |
| Order to Cash | Quotation confirmed as a sales order, delivery, customer invoice, customer payment |
| Procure to Pay | Purchase order, receipt, vendor bill, vendor payment |

- Each step is done in the UI by a separate user with Odoo's standard access rights for that job: sales, purchasing, warehouse, accounting. The administrator is used only for setup and API checks.
- After every step that posts accounting entries, the test checks the journal items (accounts, debits, credits) against expected values. After every stock move, it checks the on-hand quantity.
- Tests create their own records (users, customers, vendors, products) through Odoo's external API. No test depends on another test or on shared records, so tests can run in parallel.
- The API is used for setup and checks; the UI is used for the business steps under test.
- The two full-cycle tests are tagged `@smoke`.

The test plan is in [specs/odoo-cycles.plan.md](specs/odoo-cycles.plan.md). The specs are in `tests/order-to-cash` and `tests/procure-to-pay`.

Out of scope: manufacturing, POS, eCommerce, HR, reports, printing, email.

## The app under test

Odoo Community 19.0 (official `odoo:19.0` Docker image) with PostgreSQL 17, started from [docker/compose.yml](docker/compose.yml) on http://localhost:8069. The compose file sets the project name `odoo-playwright`, so its containers and volumes stay apart from other Docker projects on the same computer.

The suite creates its own database, with the Sales, Purchase, Inventory and Invoicing apps and no demo data. It works on a brand-new Odoo and on one it has already set up. No manual steps in the browser are needed.

## Run it locally

Prerequisites: Node.js (current LTS), Docker with Compose.

```bash
# 1. Install dependencies and the Chromium browser
npm ci
npx playwright install chromium

# 2. Create your settings file (never committed)
cp .env.example .env        # PowerShell: Copy-Item .env.example .env

# 3. Start Odoo and PostgreSQL, and wait until Odoo is healthy
docker compose -f docker/compose.yml up -d --wait

# 4. Type-check and run the suite
npx tsc --noEmit
npx playwright test
```

The first `npx playwright test` runs the `setup` project, which creates the database, installs the apps and creates one user per role. Later runs reuse what is already there.

Useful variations:

```bash
npx playwright test --grep @smoke      # only the two cycle tests
npx playwright test --project=setup    # only the setup
npx playwright test --ui               # Playwright UI mode
npx playwright show-report             # open the HTML report of the last run
```

To start again from a brand-new Odoo, remove the containers and their volumes:

```bash
docker compose -f docker/compose.yml down -v
```

### Settings

Settings come from `.env`; [.env.example](.env.example) lists every variable with a comment.

| Variable | Meaning |
| --- | --- |
| `ODOO_URL` | Where Odoo runs |
| `ODOO_MASTER_PASSWORD` | Database manager password (compose reads it too) |
| `ODOO_DB` | Name of the database the suite creates and uses |
| `ODOO_ADMIN_LOGIN`, `ODOO_ADMIN_PASSWORD` | Administrator of that database, for setup and API checks only |
| `ODOO_COUNTRY`, `ODOO_LANG` | Company country (selects the chart of accounts) and language |
| `ODOO_USER_PASSWORD` | Password given to the four role users |

## Project structure

```
.
├── CLAUDE.md                     The brief the agents work from
├── prompts.md                    Every prompt given to an agent, in order
├── results.md                    Measurements and findings
├── docker/compose.yml            Odoo 19.0 + PostgreSQL 17
├── .env.example                  Settings template
├── playwright.config.ts          Projects: setup, then chromium
├── .github/workflows/            GitHub Actions workflow
├── .claude/agents/               Planner, generator and healer agent definitions
├── .mcp.json                     Playwright test MCP server used by the agents
├── specs/
│   └── odoo-cycles.plan.md       Test plan written by the planner agent
├── src/
│   ├── api/                      Client for Odoo's external API
│   ├── fixtures/                 API client and a logged-in page per role
│   ├── pages/                    Page objects
│   ├── config.ts                 Reads settings from .env
│   └── roles.ts                  The four roles and their access groups
└── tests/
    ├── setup/odoo.setup.ts       Creates the database, apps and role users
    ├── seed.spec.ts              Seed test the planner starts from
    ├── order-to-cash/
    └── procure-to-pay/
```

Conventions:

- Page objects in `src/pages`, fixtures in `src/fixtures`, the API client in `src/api`.
- Locators use roles, labels or stable attributes. No `page.waitForTimeout`.
- Chromium only.
- An assertion is never weakened, removed or skipped to make a test pass. If Odoo behaves wrongly, the assertion stays, the test is marked `test.fail()`, and it carries an annotation `{ type: 'bug', description: '...' }`.
- Where Odoo Community can't do something in scope, the README says so and the suite tests what it can do.

## Continuous integration

[.github/workflows/playwright.yml](.github/workflows/playwright.yml) runs on push, pull request, nightly (02:00 UTC) and on demand. It type-checks, starts a brand-new Odoo from `docker/compose.yml`, runs the suite, and then runs it a second time against the Odoo it has just set up.

## How this was built

Claude Code and the Playwright test agents wrote all the code in this repo. A person gave the instructions and reviewed the output; nobody edited code by hand.

1. **The brief.** [CLAUDE.md](CLAUDE.md) states the goal, the app, the scope, the rules and the definition of done. Claude Code reads it at the start of every session, so every agent run works from the same rules.
2. **Foundation.** Claude Code's main session built the Docker setup, the settings, the API client, the setup project that creates the database and role users, and the fixtures. It ran `npx tsc --noEmit` and the setup twice (brand-new and already set up) before reporting.
3. **Plan.** The Playwright *planner* agent explored Odoo in a browser, starting from `tests/seed.spec.ts`, and saved the test plan to [specs/odoo-cycles.plan.md](specs/odoo-cycles.plan.md).
4. **Generate.** The Playwright *generator* agent turned each scenario of the plan into a spec by driving the browser and recording the steps.
5. **Heal.** The Playwright *healer* agent ran the failing tests, inspected the page, and fixed them.
6. **Review.** The person reviewed every step, corrected or rejected output, and gave the next instruction. Corrections are recorded with the prompt that caused them.
7. **Page objects and CI.** Claude Code's main session moved repeated UI steps into page objects and wrote the GitHub Actions workflow.

The agent definitions are in [.claude/agents](.claude/agents) and the browser tooling they use is configured in [.mcp.json](.mcp.json).

The record of the work:

- [CLAUDE.md](CLAUDE.md): the brief the agents were given.
- [prompts.md](prompts.md): every prompt given to an agent, in order, with what happened and what was corrected.
- [results.md](results.md): measurements and findings.

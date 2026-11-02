# Results

Model: the Playwright agents run on Sonnet (set by init-agents). Main session: not recorded yet.

## Effort

| Measure | Value |
| --- | --- |
| Prompts | 11 so far |
| Hours | Not measured yet |
| Sessions | Not measured yet |

## Quality

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

## Compared with the hand-built ERPNext suite

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

## Notes for "What I learned" (draft)

- The generator agents wrote tests without running them, and guessed locators. Generated tests need checking even when the agent sounds confident.
- An agent told never to weaken an assertion still made a failing test green with a blanket test.fail(). The rule alone didn't stop it; reviewing the diff did.
- The plan expected the purchasing user to see buttons a segregated role shouldn't have. The agent didn't catch this; my ERP role knowledge did.
- What looked like missing access was one field on a form. Asking the agent to check Odoo's own code, instead of adding rights, kept segregation of duties intact. ERPNext's accounting role can't open purchase orders at all; Odoo's can.
- Most healing was correcting the generator's guesses: field names, button labels and locators that didn't exist in Odoo 19. Once fixed, the full run fell from 16.8 minutes to 36 seconds.
- Odoo hides the delivery's Validate button from sales users, but its server lets them validate anyway. Role-based tests through the API found what UI-only testing would have missed.
- Giving a known issue its own test kept test.fail() honest: it covers one check, fails at the exact assertion, and will flag itself when Odoo changes.
- The healer agent couldn't run commands, so Claude Code's main session did most of the healing and proved each fix by running the test.
- On Windows, a browser left open by the generator's session locked the test-results folder and stalled the next run.
- The agent flagged its own uncertain choices (access rights, the deprecated API) for me to decide, which made the review faster.
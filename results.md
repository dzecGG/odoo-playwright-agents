# Results

Model: the Playwright agents run on Sonnet (set by init-agents). Main session: not recorded yet.

## Effort

| Measure | Value |
| --- | --- |
| Prompts | 10 so far |
| Hours | Not measured yet |
| Sessions | Not measured yet |

## Quality

| Measure | Value |
| --- | --- |
| Tests generated | 8 |
| Passed on the first run, before healing | 1 of 8 (12.5%). The one pass, P2P-N2, accepted either outcome, so no test was trustworthy on the first run. |
| First full run time | 16.8 minutes, mostly failing tests waiting out their timeouts |
| Healed so far | 4 of 7 (P2P-01, P2P-N1, P2P-N3, O2C-N3). O2C-01, O2C-N1 and O2C-N2 are waiting on role decisions. |
| Full run time | 36 seconds after healing, down from 16.8 minutes |
| Healer fixes accepted / rejected | 2 accepted from the healer (removed the blanket test.fail(); wait for the save at step 2), 0 rejected. The healer had no shell, so Claude Code's main session did the remaining fixes and ran every check. |
| Flaky tests (5 repeats) | Not measured yet |
| Wrong assertions caught in review | 2: P2P-N2 accepted either outcome; P2P-01 was wrapped in a blanket test.fail() that hid a failing step |
| Odoo bugs found | 0 bugs. 1 segregation-of-duties finding pending confirmation: a Sales: User can validate a delivery through the external API. |

## Compared with the hand-built ERPNext suite

| Question | Hand-built (ERPNext) | Agent-built (Odoo) |
| --- | --- | --- |
| Checks the ledger after every posting step | Yes | Yes in P2P-01 (bill and payment); other tests not checked yet |
| Uses a separate user per role | Yes, 4 | Yes, 4 |
| Sets up the app with no manual steps | Yes | Yes (setup passes) |
| Passes on a brand-new install | Yes | Not measured yet |
| App bugs found | 1 | 0 bugs; 1 segregation-of-duties finding pending confirmation |
| Accounting role can open purchase orders by default | No | Yes, read and edit, but not create |
| Lines of TypeScript | Not measured yet | Not measured yet |
| Time to run the suite | Not measured yet | Not measured yet |

## Notes for "What I learned" (draft)

- The generator agents wrote tests without running them, and guessed locators. Generated tests need checking even when the agent sounds confident.
- An agent told never to weaken an assertion still made a failing test green with a blanket test.fail(). The rule alone didn't stop it; reviewing the diff did.
- The plan expected the purchasing user to see buttons a segregated role shouldn't have. The agent didn't catch this; my ERP role knowledge did.
- What looked like missing access was one field on a form. Asking the agent to check Odoo's own code, instead of adding rights, kept segregation of duties intact. ERPNext's accounting role can't open purchase orders at all; Odoo's can.
- The healer agent couldn't run commands, so Claude Code's main session did most of the healing and proved each fix by running the test.
- On Windows, a browser left open by the generator's session locked the test-results folder and stalled the next run.
- The agent flagged its own uncertain choices (access rights, the deprecated API) for me to decide, which made the review faster.
- Most healing was correcting the generator's guesses: field names, button labels and locators that didn't exist in Odoo 19. Once fixed, the full run fell from 16.8 minutes to 36 seconds.
- Odoo hides the delivery's Validate button from sales users, but its server lets them validate anyway. Role-based tests through the API found what UI-only testing would have missed.
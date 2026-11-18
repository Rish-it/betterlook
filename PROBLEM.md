# PROBLEM.md

The problem Betterlook solves. Every change in this repository serves it. When a doc, a habit or an Onlook feature conflicts with this file, this file wins.

## Statement

**Betterlook** is a visual editor where designers describe a UI change in plain language and an AI agent edits the real code of their React app. Onlook already makes the edit. It does not know whether the edit was good. Today an edit can break the build, touch code outside the request, regress the layout, behave differently on a second run, or follow an instruction hidden in a file or web page, and the designer is the one who finds out.

**We are handling evals.** The job is to make Betterlook's agent measurably controlled and confident, without the designer seeing any of the machinery:

- Learn how the agent actually fails by reading real traces, before choosing any metric.
- Check every edit against the real outcome (build, diff scope, rendered UI) with deterministic checks first, and narrow, human-calibrated judges only where code can't decide.
- Block regressions before merge, and measure reliability across repeated runs (`pass^k`), not one lucky run.
- Trace every session with secrets redacted, so real failures become new test cases.
- Prove that prompt and harness changes improve the agent on a frozen suite, across the models users choose.

## Constraints

- No model training of any kind.
- Users bring their own model keys.
- The team writes every rubric, judge, label and safety fixture by hand.
- The frontend is a new minimal Astryx shell.
- Cut anything not driven by an observed failure.

## The failures we know of

These are the failures the statement names. A new one joins this list only from a real trace.

| Failure | What the designer sees today |
|---|---|
| Build breaks | The app stops rendering after the edit. |
| Out-of-scope diff | Files or code the request never mentioned changed. |
| Layout regression | Something other than the requested element moved or broke. |
| Nondeterminism | The same request gives a different result on a second run. |
| Prompt injection | The agent followed an instruction found in a file or web page, not the designer's. |

## Done means

- A designer's edit is checked against the build, the diff and the rendered UI before they are told it worked.
- A prompt or harness change merges only if it does no worse on the frozen suite, measured as `pass^k`, on every model users can pick.
- Every session leaves a redacted trace, and a failure found in one can become a test case.
- None of this adds a screen, a control or a wait the designer has to manage.

## Decisions

- Betterlook is a web app, built from scratch, frontend and agent backend alike. No Onlook code is reused; Onlook is only the product we measure against.
- English only. No translations, no changesets.

# AGENTS.md

Rules for every coding agent on Betterlook, Claude and Codex alike. Claude Code reads this through `CLAUDE.md`.

Read `PROBLEM.md` before any task. It decides scope, and where anything conflicts with it, it wins.

## What this is

Betterlook is a web visual editor. A designer describes a UI change in plain language, an agent edits the real code of their React app, and Betterlook checks the edit before the designer is told it worked. It is built from scratch: Onlook is the product we improve on, not a codebase we use. No Onlook code, dependencies or docs are copied in.

## Product rules

- **An MVP.** Build what `PROBLEM.md` needs and nothing else. Deletion over addition.
- **No failure, no work.** A new check, metric, judge, fixture or feature names the observed failure that drove it: a trace, or a row in `PROBLEM.md`'s failure table. Without one, it isn't built.
- **Eval order.** Read traces, then name the failure, then a deterministic check (build, diff scope, rendered UI). A judge comes only where code can't decide, and only after it agrees with human labels.
- **Humans write the eval content.** Rubrics, judge prompts, golden labels and safety fixtures are written by the team. A coding agent builds the harness that runs them, and never writes or edits their content. Where a task needs one, leave a clearly empty slot and say so in the handoff.
- **Reliability is `pass^k`.** One passing run proves nothing. Report pass^k over a frozen suite, per model.
- **Hidden machinery.** The designer sees the edit and its outcome. Evals, traces and judges add no screen, control or setting to the designer's UI.
- **Keys stay the user's.** Users bring their own model keys. Keys are never logged, traced, committed or sent anywhere but their provider. Traces redact secrets before they are written to disk.
- **No training.** Nothing fine-tunes, distils or trains on user data.
- **English only.** No translations, no changesets.

## Code rules

- **Understand, then reuse.** Trace the behaviour end to end and fix the root cause. Before writing anything, reuse what the repo already has, then the standard library, then the platform, then an installed dependency. Add a dependency only when none of those can do it, and say why in the handoff.
- **Task-only diff.** Change only what the task needs: no renames, reformatting or cleanup of nearby code.
- **Tests.** A reproducible bug gets a failing test first, then the fix. Non-trivial logic leaves one small test behind. No new test framework.
- **Verify twice.** Run the checks in two separate clean runs before handing off. Both must pass.
- **No speculative code.** No abstraction with one user, no config for a value that never changes, no scaffolding for later.
- **Comments.** None by default. One short line only when it prevents a likely mistake a better name can't.
- **Docs** state present-tense rules, and change in the same commit as the code that makes them wrong.
- **Commits:** `type(scope): what changed`, present tense. Types `feat|fix|chore|docs|test|refactor|perf|build|ci`. No AI, model or tool attribution in commits, PRs, branch names or code.
- **Nothing private in the tree:** no keys, emails, personal names or internal links.

Claude sessions apply these through the `carmy` and `ponytail` skills and run `ponytail-review` on the diff before handoff. Codex sessions apply them through `carmy`. Any React change runs `npx react-doctor@latest` and fixes what it reports. Outside research uses `agent-reach`, and any claim that drives a decision cites its source.

## Working as one of several agents

Several agents work on Betterlook at once, each in its own workspace and branch, coordinated by an orchestrator.

- One task, one branch. Change only the files your task names. If you need to touch another file, stop and report it as blocked.
- Never merge, rebase onto, or push to the base branch. The orchestrator integrates.
- Commit on your branch only when your task says to.
- End your final message with exactly one of these envelopes:

```text
SUPERSET_WORKER_DONE
task: <task-id>
summary: <one-line outcome>
files: <comma-separated paths or none>
checks: <commands and outcomes, both runs>
handoff: <next-step context or none>
```

```text
SUPERSET_WORKER_BLOCKED
task: <task-id>
reason: <specific blocker>
needs: <decision, access, or dependency required>
```

# Betterlook

A visual editor for React apps. A designer describes a UI change in plain language, an agent edits the real code of the app, and Betterlook checks the edit (build, diff scope, rendered UI) before the designer is told it worked. Evals measure how reliably it does that, without adding anything to the designer's screen.

`PROBLEM.md` defines the problem and scope, and wins on any conflict. `AGENTS.md` holds the rules for everyone working in this repo.

## Layout

| Path | What it holds |
|---|---|
| `apps/web` | The Next.js app: landing page, workspace (chat + live preview), API routes |
| `apps/web/src/lib/agent` | The agent turn: model call loop, tools, policy, checkpoint, verify, turn record, task runner |
| `apps/web/src/lib/sandbox` | The starter React app and the Vercel Sandbox that runs it |
| `apps/web/src/lib/evals` | The E1–E8 check library, page evidence collector, E7 judge, Langfuse client |
| `apps/web/scripts` | `agent-run.ts`, the batch runner |
| `evals/EVALS.md` | The frozen eval specification |
| `evals/tasks/v1.md` | The frozen 12-task benchmark |
| `supabase/migrations` | Database migrations |
| `debug/`, `notes/` | Incident write-ups and parked ideas |

## Setup

```sh
bun install
cp apps/web/.env.example apps/web/.env   # then fill in the values
bun run dev                              # http://localhost:3100
```

In a fresh checkout, run `bunx next typegen` once in `apps/web` before `bun run typecheck`.

Variables (names only; see `apps/web/.env.example` for what each is for):

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DIRECT_URL`
- Sandbox: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` (local and batch runs only; a deployment opts in with `BETTERLOOK_SANDBOX=on`)
- Tracing: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`
- Evals: `ANTHROPIC_EVAL_API_KEY`; optional `OPENAI_EVAL_API_KEY`

Designers bring their own model keys in the app. Those keys are never logged, traced or stored on the server.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Run the app |
| `bun run typecheck` | `tsc --noEmit` in `apps/web` |
| `bun run test` | Unit tests (`bun test`; tests never load `.env`) |
| `bun --cwd apps/web build` | Production build |
| `bun run db:migrate` | Apply Supabase migrations with drizzle-kit |
| `bun run agent:run` | Run tasks from a Markdown task file through the agent in fresh sandboxes |
| `bun run eval` | Run the benchmark and score it (see Evals) |

## How a turn works

1. The designer's message and the project's `DESIGN.md` (sent as context after the cached prefix) go to the chosen model with six tools: `list_files`, `read_file`, `search`, `edit_file`, `write_file`, `typecheck`.
2. A policy checks every call: `.git` and `node_modules` are denied, config, lock and env files need the designer's approval. Writes run one at a time; reads run in parallel.
3. A step cut off by the output limit returns an error to the model for each call that did not run, and the turn continues within its step cap. Every tool call ends done, error, denied or cancelled.
4. If files changed, the turn is committed as a checkpoint the designer can restore, then verified: typecheck, build, and a runtime check in a real browser. One repair attempt follows a failed check.
5. The turn ends as `passed`, `unverified` (a check could not run), `failed`, `no-changes`, `stopped`, `awaiting-approval` or `error`. Every turn is traced to Langfuse with secrets redacted.

## Evals

The specification is `evals/EVALS.md` (SHA-256 `36d8f183d42c9b3c35c347fa429774c421fb4e1d3ead0f2b549704ca97949f0f`). It is frozen: thresholds and score definitions do not change to make results look better.

**Design contract.** Section 0 of the spec defines the visual system every result must keep: Geist Sans, Geist Mono and Geist Pixel Square faces, keyword spans, monochrome colours, no borders, typography, geometry, press motion. The starter follows it and ships it as `DESIGN.md`.

**Eight checks**, each scored `PASS`, `FAIL`, `NOT_EVALUATED` or `NOT_APPLICABLE` with a one-line reason. Missing evidence is never a pass, and neither `NOT_EVALUATED` nor `NOT_APPLICABLE` counts as one.

| Eval | Checks |
|---|---|
| E1 | Request fulfilled (the task's `expect` assertions) |
| E2 | Invariants preserved (hero, file scope, visual diff) |
| E3 | Font assignment and loading |
| E4 | Visual system, 11 subrules E4a–E4k |
| E5 | Grounded edits |
| E6 | No looping |
| E7 | Honest completion: a deterministic pre-check, then a judge |
| E8 | Prompt-injection resistance; a high-severity hit is a hard failure |

**Tasks.** `evals/tasks/v1.md` holds 12 frozen tasks, 4 of them tagged `regression`. Taskset hash (SHA-256): `5c33dfd1df6cb9c9b7222412bfd7e5337343f4165aa08b981a7aa10a01d08e60`. Each task has `prompt`, `starter`, `notes`, `expect`, `allowed_files`, `tags` and `applies`.

**Three triggers share one check library** (`apps/web/src/lib/evals`):

- **A. Every live turn:** built. Inside verify, in the same browser session, the turn is scored on E2 (hero and file scope), E3, E4, E5, E6 and the E7 pre-check; E1 and E8 do not apply to live turns. No model call happens during the turn. Scores attach to the turn's Langfuse trace after the response, and the added verify time is recorded as `addedVerifyMs`. 5% of live turns are sent to the E7 judge afterwards, without blocking.
- **B. Benchmark CLI:** built, not yet run. `bun run eval --tasks evals/tasks/v1.md --runs <k> --model <id>` runs every task through the agent in a fresh sandbox per trial (at most 3 at once, with backoff on rate limits), scores E1–E8, and records a Langfuse dataset from the frozen tasks plus one experiment per model with trace-linked scores. Records are sanitized and scanned for secrets and canaries before anything is published. Flags: `--tag regression`, `--no-judge`, `--max-usd <n>`, `--baseline <summary.json>`, `--concurrency <n>`, `--out <dir>`, `--dry-run` (plans the runs from local files, with no model call, sandbox or Langfuse write). `bun run eval --annotation-queue` creates the E7 calibration queue. Exit codes: 1 setup blocked, 2 E8 high-severity hit, 3 sanitization blocked, 4 new E1/E2 failure against the main baseline.
- **C. GitHub Action:** built (`.github/workflows/evals.yml`). On non-fork pull requests and pushes to `main` that touch `lib/agent/**`, `lib/evals/**`, the starter, `scripts/eval.ts` or `evals/**`, it runs the `regression` tasks once per model with code checks only (no judge) and a $2 spend cap per model. Pushes to `main` store the baseline; pull requests compare against it, and a missing baseline makes the comparison `NOT_EVALUATED`. It needs the repository secrets `ANTHROPIC_EVAL_API_KEY`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`; without them it exits as setup blocked.

**E7 judge.** It uses the spec's instruction word for word and stores its SHA-256 and the resolved model ID. It runs on `OPENAI_EVAL_API_KEY` when set; otherwise on `claude-haiku-5-5`, marked `same_family: true`. Human labels are collected separately and are never filled in automatically.

**Config hash.** Every scored run records a config hash over the system and repair prompts, the agent config, the tool definitions, the `DESIGN.md` hash, the judge instruction hash and the evaluator version. Current config hash (SHA-256): `c2c606b14cffed75694742d65f6d66a7fb0685a8280f8080dec2706530b78f95`.

**Progress** is tracked item by item, with proof, in `eval-progress.md`.

### Baseline scores

Not run yet. The benchmark (Claude Haiku 5.5 ×5 and Claude Sonnet 5.5 ×2 on the 12 tasks, 84 runs) is built and has not been executed; `eval-progress.md` lists the commands to run it, starting with a one-run smoke test. Results will be added here from real runs only, with denominators; anything that does not run will be listed as `NOT_EVALUATED` with its reason. The baseline will run with an empty system prompt plus `DESIGN.md` as project context.

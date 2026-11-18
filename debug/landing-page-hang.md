# Landing page turn hangs with pending writes but reports "Checks passed"

Repro: fresh project, Claude Sonnet 5.5, prompt "Design a landing page for addidas".
Turn `e2d70d3b-2cf7-438a-839a-6a7b12f7fd69`, trace `22a7cd4bdd216d1c56e7034631a1c1af`, sandbox `turquoise-cheerful-cardinal-w4rcrz`.

Evidence sources: dev server log for `/api/chat`, the chat the page saved (`betterlook.chat` in the pane's localStorage, which holds every UI part and its state), Langfuse v2 observations for the trace, and `git` run inside the sandbox. No keys or env values appear below.

## Root cause in one paragraph

Step 3 asked the model to write three whole files at once. It used all 8,000 output tokens (`maxOutputTokens` in `lib/agent/config.ts`, thinking included) and stopped with `finish_reason=length` while still streaming the third file. The AI SDK (`ai` 7.0.176, `dist/index.js:3237` and `:8469`) only executes queued tool calls when a model call ends with `stop` or `tool-calls`. On `length` it drops them silently: no result, no error, and no next step. `runAgent` treats every non-error end as success (`run.ts` `settled()` only special-cases `content-filter`), so it committed an empty checkpoint, ran verify on the untouched starter, and reported "passed".

## Timeline (server clock, UTC)

| Time | Event | Evidence |
|---|---|---|
| — | `GET /workspace?prompt=…`, sandbox reconnects in 2.4 s | server log |
| — | `POST /api/chat` **401** (no Anthropic key in the page yet). User message `xBZLtJB68mAkmM9o` stays in the chat with no reply | server log, saved chat |
| — | Key added via Connect models; prompt sent again: user message `HxskbyrtIY8qDJ6c`. `POST /api/chat` 200 in 63 s. Both user messages go to the model | server log, saved chat |
| 16:12:38.8 | Step 1: 989 in / 94 out, `tool-calls` → `list_files` | Langfuse |
| 16:12:40.5 | Step 2: 1,146 in / 243 out, `tool-calls` → 5 × `read_file` in parallel, all complete | Langfuse TOOL spans |
| 16:12:42.7 | Step 3 starts: reasoning (empty text), then `write_file index.html` (442 chars, complete), `write_file src/App.tsx` (11,590 chars, complete), `write_file src/index.css` (5,418 chars, **cut off**) | saved chat parts |
| 16:13:29.25 | Step 3 ends: 2,285 in / **8,000 out**, `max_tokens=8000`, **`finish_reason=length`**. No TOOL span follows | Langfuse |
| 16:13:29.25 | Agent loop ends, `invoke_agent` `finish_reasons=length` | Langfuse |
| 16:13:29–40 | `commitTurn` makes empty commit `694b84c` (`--allow-empty`), emits `data-checkpoint` and `data-diff {diff:"", filesTouched:[]}`, verify runs typecheck, build and runtime on the starter: all passed, `ok:true`, status `passed` | saved chat, `checkpoint.ts:20`, `verify.ts:38` |
| after | Sandbox: `git status` clean, `git log` = `694b84c turn e2d70d3b…`, `da7bb5d starter`. `index.html` 294 B, `src/App.tsx` 286 B, `src/index.css` 433 B (starter sizes) | `git`/`wc` in the sandbox |

Final tool-part states the client kept: `list_files` and 5 × `read_file` `output-available`; `write_file index.html` `input-available`, `write_file src/App.tsx` `input-available`, `write_file src/index.css` `input-streaming`. None has an output or error, so the UI spins forever.

## The six observations

1. **User message twice.** Two real sends with different ids, about a minute apart: the first got a 401 because no key was set yet; the second followed adding the key. Not a double submit or a render duplicate; dedupe by id would not catch it. Cause: the first send goes out before a key exists, and a failed request leaves its user message with no reply and no retry, so resending appends a copy. *(Please confirm you re-sent it by hand after adding the key.)*
2. **list_files and 5 read_file green.** Steps 1 and 2 ended with `tool-calls`, so the SDK ran them.
3. **Three write_file spinning forever.** Step 3 ended with `length`; the SDK skipped execution, so no part ever reached a terminal state. The third input was still streaming when the token cap hit.
4. **"Checks passed" and a checkpoint.** `runAgent` treats `length` as a normal end, checkpoints an empty commit and verifies the unchanged starter. `verify` says `ok` whenever no check failed; it never looks at the diff.
5. **Preview shows the starter.** Correct for the sandbox: nothing was written.
6. **Empty "Thought" blocks.** We never set a thinking display, so Sonnet 5.5 uses its default `omitted`: reasoning parts arrive with empty text, and the UI still draws the header. (The first block's visible line is the step's text part, not reasoning.)

## Hypotheses

| | Verdict | Evidence |
|---|---|---|
| A. Approval deadlock | **Ruled out** | None of `index.html`, `src/App.tsx`, `src/index.css` matches `approvalFiles` (`package.json`, lockfiles, `tsconfig*.json`, `*.config.*`, `.env*`). No `tool-approval-request` part reached the client; every part has `approval: null`; turn status is `passed`, not `awaiting-approval`. |
| B. Write serialization deadlock | **Ruled out as the cause** | No write ever started (no TOOL span after step 3), so nothing could wait on a lock. Separate gap: there is no write serialization at all. We set no `toolCallConcurrency` and have no lock, so parallel writes would run concurrently, against our standard. |
| C. Truncated tool input | **Confirmed, root cause** | Step 3 output 8,000 = `max_tokens` 8,000, `finish_reason=length`, third input cut at 5,418 chars. Our input validation never ran because the SDK drops calls on `length` before execute. Nothing turns the truncation into an error the model sees. |
| D. Stream or lifecycle break | **Confirmed in part** | The stream did not break: 200 in 63 s, no server error, no abort, no execute promise left hanging (none started). The break is ours: the turn-end path commits, verifies and reports `passed` with three unresolved tool calls. |
| E. Preview not reflecting writes | **Ruled out for this turn** | Nothing was written. Separate gap: the preview reloads only on Restore or the refresh button, not after a write turn; we rely on Vite HMR through the sandbox port. |
| F. Duplicate message | **Explained** | Two sends (401, then 200), two ids; see observation 1. |
| G. Empty thinking | **Confirmed** | No `thinking` display set for Anthropic; parts arrive with empty text. |

## Proposed fixes (smallest diff, one test each that fails today)

1. **Truncated step (C, D).** When a step ends with `length` and has tool calls without results, return each one to the model as an error result: "Output limit reached before this call ran; write smaller files or one file per call". Then take the next step within the step cap, instead of ending the turn. A call whose input was cut off becomes an error result too, never a pending part. Raising `maxOutputTokens` for edit turns needs your call: Sonnet 5.5 allows up to 128K when streaming. My suggestion is 32K, still capped by the per-turn budget.
2. **No silent end with unresolved calls (D).** A turn cannot commit, verify or checkpoint while any tool call lacks a terminal state. Any call left at turn end is marked `cancelled` with a reason, both in the stream and in the UI.
3. **Verify outcome (observation 4).** An empty diff on a turn that issued writes, or any failed write, is not "passed". "No changes made" becomes its own visible outcome. No empty checkpoint for a turn that changed nothing.
4. **Writes one at a time (B).** Serialize `write_file` and `edit_file` through one promise chain that releases in `finally`; reads stay parallel. Test: three parallel writes in one step finish in order.
5. **Approval always visible (A, invariant).** An approval request always renders as a card. Any request the UI can't render is denied with a reason, never left pending.
6. **One user message per send (F).** Hold the first send until the selected model's provider has a key: show "Add an Anthropic key to send" and keep the prompt in the composer. A failed request offers Retry, which resends the same message id, instead of leaving an orphan. Messages are deduped by id.
7. **Preview reload (E).** Reload the preview iframe after any turn whose diff is non-empty.
8. **Thinking (G).** Set `display: "summarized"` on the Anthropic adapter for the UI path. Hide a reasoning block whose text is empty.

Approved with changes: 32K cap with the output-limit continuation as a guard, per-step finish reason and output tokens plus `lengthStops` in the turn record, effort set explicitly.

## Fixed by

Server (merge `12e0e04a`, branch `fix-core-hang`):

- `57876dfd` effort `medium` and summarized thinking on every model call (fix 8, server)
- `686add09` `write_file` and `edit_file` run one at a time; reads stay parallel (fix 4)
- `3e6a8622` per-step finish reason and output tokens, `lengthStops` in the turn record and trace metadata
- `0d93b678` an empty diff ends as `no-changes`: no checkpoint, no verify (fix 3)
- `e349a45f` a turn whose last write to a path failed ends `failed` (fix 3)
- `63505b6b` tool calls left without a result are cancelled with a reason before any checkpoint (fix 2)
- `4ed0da93` a step cut off by the output limit returns an error result per unrun call and the turn continues; `maxOutputTokens` 32,000 (fix 1)

Client (merge `111387a9`, branch `fix-ui-hang`):

- `49c0c3be` an approval request with no card is denied with a reason (fix 5)
- `03526e85` a send waits for the chosen provider's key (fix 6)
- `f0428439` Retry resends the same user message (fix 6)
- `7cc758f3` messages render once per id (fix 6)
- `a8f8e25f` the preview reloads after a turn that changed files (fix 7)
- `c0a86e17` empty reasoning parts are hidden (fix 8, UI)
- `92967113` cancelled calls show their reason, apart from errors

Live rerun on the merged code, same prompt, Claude Sonnet 5.5: trace `04c95829c93e286eb3a39c1e72def4f0`, turn `a53cb583-bf0d-4a17-a574-3e1165d182ba`, sandbox `cyan-charming-blackbird-tUgp3r`.

| Step | Finish reason | Input | Output |
|---|---|---|---|
| 1 | tool-calls | 978 | 26 |
| 2 | tool-calls | 1,067 | 151 |
| 3 | tool-calls | 1,705 | 3,559 |
| 4 | tool-calls | 5,342 | 27 |
| 5 | stop | 5,391 | 467 |

All 7 tool calls reached `output-available` (list_files, 3 × read_file, write_file `src/App.tsx`, write_file `src/index.css`, typecheck); none unresolved. Sandbox git: `fe12ee6 turn a53cb583…` on `da7bb5d starter`, clean tree, 2 files changed, 293 insertions, 20 deletions. Verify: typecheck, build and runtime passed; status `passed`; `lengthStops` 0. The reasoning part carried 202 characters of summarized text.

Not exercised live: this run never hit the output limit (step 3 used 3,559 of 32,000 tokens at medium effort), so the continuation path is covered by unit tests only.

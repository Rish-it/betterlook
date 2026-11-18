# AI core upgrade progress

Worker: AI-CORE-2, branch `ai-core-v2`. One item per loop round, proved before it is ticked. Standards, ground rules and ownership are in the founder's loop prompt; `PROBLEM.md` wins on any conflict.

## Checklist

- [ ] Audit and baseline: compare the current core against every standard above, as a table (standard, current state, planned change, file). Then run agent:run on my frozen task file at k=3 and record the baseline: pass^k from my graders, cost per completed task, cache hit ratio, p50 and p95 turn latency, tokens per turn. Stop and wait for my OK on the plan.
- [ ] Request shape and caching: stable prefix, breakpoints, sorted tools, volatile context after the prefix; cache hits recorded and non-zero after turn one.
- [ ] Tools: strict schemas, descriptions, tool context instead of model-filled ids, stale-write check, parallel-safe reads, truncation, image results, input validation and repair.
- [ ] Loop control and budgets: stop conditions, per-turn budget and caps, every stop reason handled.
- [ ] Context: append-only history verified, provider context editing and compaction on, model registry in place.
- [ ] Reasoning and effort: adaptive thinking, effort per route, summarized display wired to the thinking component.
- [ ] Approvals and policy: toolApproval-based policy, protected paths, no-retry instruction, decisions recorded.
- [ ] Errors and providers: typed error chain, retry rules, separate rate budgets, Anthropic and OpenAI adapters, the same task passing on both.
- [ ] Turn record v2 and config hash.
- [ ] Settings panel: sidebar entry, four tabs, server-side clamping, persistence.
- [ ] Re-measure: the same agent:run at k=3 on the same frozen tasks, per provider. Put the before/after table in the progress file. Any drop in pass^k or rise in cost per completed task is a blocker to explain or fix, not to hide.

### Item 1: audit (round 2, 2026-11-18)

Read: `lib/agent/{run,tools,policy,model,models,config,errors,types,verify,runner,trace,system-prompt,client}.ts`, `lib/sandbox/*`, `app/api/chat/route.ts`, `workspace/Workspace.tsx`, `components/ai/*`. Installed: `ai` 7.0.176, `@ai-sdk/anthropic` 4.0.106, `@ai-sdk/openai` 4.0.121, `@ai-sdk/react` 4.0.180. Each "planned change" uses an option I found in the installed type definitions. Nothing here needs a new dependency.

| Standard | Current state | Planned change | File |
|---|---|---|---|
| **Request shape and caching** | | | |
| Render order tools, system, messages | The AI SDK sends `tools`, `system` and `messages` as separate fields; Anthropic renders them as tools, then system, then messages | None needed; assert it in a request-body test | `run.test.ts` |
| Byte-stable prefix | `SYSTEM_PROMPT` is a constant (empty today, founder slot). Tools come from `AGENT_CONFIG.tools` in declaration order, not sorted. No timestamps or ids go before messages | Build tools in sorted name order; a test checks that the serialized tools and system are byte-identical across two turns | `tools.ts`, `run.test.ts` |
| One 1h breakpoint on tools + system, automatic caching for the tail | No `cacheControl` set on Anthropic; OpenAI sends `promptCacheKey = project.id` | Anthropic adapter: `cacheControl {type: 'ephemeral', ttl: '1h'}` on the last tool/system block, plus top-level automatic caching (`providerOptions.anthropic.cacheControl`). OpenAI: keep `promptCacheKey`, add `promptCacheRetention: '24h'` | new `providers/anthropic.ts`, `providers/openai.ts` |
| Never change tools or model mid-conversation | The tool set is fixed per turn. The model comes from the request body each turn, and nothing stops a switch mid-conversation | Use `activeTools` to narrow tools per phase. The route rejects a model change inside a conversation (first assistant message metadata `model` vs body) | `run.ts`, `app/api/chat/route.ts` |
| Volatile context after the prefix | No volatile context is sent today (no selected element or sandbox status) | Append volatile context as a mid-conversation system message (Anthropic supports system messages with `anthropicSystemMessageProviderOptions`), otherwise as user-turn text | `run.ts` |
| Cache read and write tokens per turn | Records `cachedInputTokens` (read) only; no cache write | Record `inputTokenDetails.cacheReadTokens` and `cacheWriteTokens`, plus hit ratio; flag a turn after the first with zero reads | `run.ts`, `types.ts` |
| **Tools** | | | |
| Few typed tools, under 20 | 6 typed tools (`list_files`, `read_file`, `search`, `edit_file`, `write_file`, `typecheck`), no shell | Keep. Add `screenshot` only if the Tools item needs image results | `tools.ts` |
| Strict schemas | `additionalProperties: false` everywhere. `list_files.path` and `search.path` are optional with `default`, not required + nullable. Strict mode is not requested | All fields required, optional ones `["string","null"]`; set `strict: true` on tools (AI SDK `tool({strict})`) and OpenAI `strictJsonSchema: true` | `tools.ts`, adapters |
| No model-filled ids | No tool takes a project or sandbox id; `project` is closed over | Keep; move to `experimental_context` only if a tool needs per-turn data | `tools.ts` |
| Descriptions: what, when, when not, example | One line each, no when-not or example | Rewrite the six descriptions. Tool descriptions are harness, not quality judgement, so I write them; the founder reviews | `tools.ts` |
| Stale-write check | None: `edit_file` and `write_file` apply even if the file changed since the last read | Track a content hash per path on `read_file`; `edit_file` and `write_file` on an existing file reject if it changed or was never read in this turn | `tools.ts` |
| Read-only tools parallel, writes serial | The AI SDK runs a step's tool calls concurrently, so two writes can race | Serialize write tools with a per-turn promise chain; reads stay parallel | `tools.ts` |
| Failures returned as error results | `execute` throws, and the AI SDK returns a `tool-error` to the model. The record keeps `{error}` | Keep; test that the model sees the error text | `tools.test.ts` |
| Truncation with a how-to-read-more note | `clip()` appends `[truncated]` at 20,000 chars, with no hint how to read the rest | Note says how many chars were dropped and to use `search` or `read_file` with a line range (add `startLine`/`endLine` nullable to `read_file`) | `tools.ts` |
| Screenshots as images via `toModelOutput` | No image results | Add a `screenshot` tool (checker already makes PNGs) returning `{type: 'content', value: [{type: 'image-data'}]}` via `toModelOutput` | `tools.ts` |
| Validate streamed inputs; `repairToolCall`; unknown tools null | The AI SDK validates input against `jsonSchema` before `execute`. No `repairToolCall` | Add `experimental_repairToolCall` that returns `null` for unknown tools and re-asks once for an invalid input | `run.ts` |
| **Loop control and budgets** | | | |
| Step cap plus done condition | `stopWhen: isStepCount(20)` only | `stopWhen: [isStepCount(cap), done]`, where done means the model ended without a tool call (the SDK default), plus the budget stop below | `run.ts` |
| Per-turn token budget the model sees; output cap; cost cap | `maxOutputTokens` 8,000 per call. No turn budget, no cost cap | Anthropic `taskBudget {type: 'tokens', total}`; `prepareStep` stops when summed usage passes the budget or the cost estimate passes the cap | `run.ts`, adapters, `config.ts` |
| Every stop reason handled | Handled: `content-filter` (refusal), step limit, abort, error. Not handled separately: `length` (max tokens), Anthropic `pause_turn`, a final `tool-calls` stop | Map each `finishReason` / raw stop reason to a status and notice; `pause_turn` continues once; max tokens gives its own notice. UI treats `unverified` as not a pass (orchestrator note) | `run.ts`, `errors.ts`, `components/ai/*` |
| **Context** | | | |
| Append-only history | The client sends full UI messages; `convertToModelMessages` rebuilds them. Reasoning parts are not round-tripped today because thinking is off | Test that turn N+1's request prefix equals turn N's request plus the new messages, byte for byte, with thinking on | `run.test.ts` |
| Provider context editing and compaction | Off | Anthropic `contextManagement.edits: [clear_tool_uses_20250919, compact_20260112]`; OpenAI `contextManagement {type: 'compaction'}`. Record `contextManagement.appliedEdits` | adapters, `run.ts` |
| Model registry | `models.ts` holds id, label and provider only. No context window or output limit | Registry with context window, output limit and capabilities. Source: `@ai-sdk/anthropic`'s model catalog (`languageModelDefinitions`) plus the provider models API where it answers, with a checked-in fallback | `models.ts` |
| **Reasoning and effort** | | | |
| Adaptive thinking, effort per route | Off; no `thinking`, no `effort` | Anthropic `thinking {type: 'adaptive', display: 'summarized'}` + `effort` per route (chat low, edit higher); OpenAI `reasoningEffort` + `reasoningSummary: 'auto'` | adapters, `config.ts` |
| Summarized reasoning in UI; raw never logged | `Thinking.tsx` is a static indicator; no reasoning streamed | Send reasoning parts (`sendReasoning`) to `Thinking.tsx`; mask/exclude reasoning text from traces | `run.ts`, `components/ai/Thinking.tsx`, `trace.ts` |
| **Approvals and policy** | | | |
| One policy via `toolApproval` | Done: `checkPolicy` decides allow, deny or approve inside `toolApproval`; protected files need approval | Add protected paths (not just basenames) from settings | `policy.ts` |
| No-retry instruction; decisions recorded | Denials and approvals are recorded. No no-retry instruction, because the system prompt is founder-owned and empty | **Question 3**: the founder adds the sentence, or I send it as the denial tool result text (harness, not prompt) | `system-prompt.ts` or `run.ts` |
| **Errors, limits and providers** | | | |
| Typed errors, most specific first | `userMessage` maps 401/403/429/else; `sandboxMessage` maps 402 | One ordered error chain (key, quota, rate, overloaded, context too long, refusal, sandbox, network, unknown); `/api/chat` uses `sandboxMessage` (orchestrator note) | `errors.ts`, `app/api/chat/route.ts` |
| Retry 429/5xx/network with retry-after | The AI SDK `maxRetries` default (2) applies; the runner adds its own 429 backoff | Explicit `maxRetries`, retry-after honoured, retries counted into the record | `run.ts`, `runner.ts` |
| Separate interactive and eval rate budgets | Separate keys: the user's key for interactive, `*_EVAL_API_KEY` for the runner | Keep; document. No shared limiter needed while keys differ | `runner.ts` |
| One adapter per provider; nothing provider-specific in `runAgent` | `runAgent` sets `providerOptions.openai` and `.anthropic` inline | `providers/anthropic.ts` and `providers/openai.ts` map our settings to provider options; `runAgent` calls one function | new `lib/agent/providers/*` |
| Keys never logged, traced or shown | Masked in traces; never logged; UI not built yet | Settings shows masked status only | `components/settings/*` |
| **Observability** | | | |
| Turn record v2 + config hash | Record has usage (in, out, cached), status, tool calls, hashes for prompt and tool config | Add cache write, hit ratio, effort, thinking tokens, stop reason, retries, approvals, context edits, and one config hash over prompt, tools, model, effort, budgets and policy | `types.ts`, `run.ts` |
| **Settings UI** | None | Sidebar entry, four tabs, server clamps every value, one exported settings schema module for the DB worker, localStorage until `user_settings` | `components/settings/*`, `lib/agent/settings.ts`, `Workspace.tsx` |

Risks found during the audit:
- **Caching may show zero reads for a reason other than a bug.** `SYSTEM_PROMPT` is empty and the six tool definitions are small. Anthropic only caches a prefix above its minimum length (for example 1,024 tokens on Sonnet). Until the founder's system prompt lands, the static prefix may sit below that minimum, so a turn after the first can show zero cache reads. I'll measure it in the caching item and report the prefix token count rather than pad the prompt.
- The runner's `costUsd` is null today (Langfuse prices traces). "Cost per completed task" needs a price source: Langfuse's computed cost per trace, read back after the run, or a price table. See Question 4.

### Item 1: baseline

BLOCKED on the task file only (Question 1). The plan above also needs the founder's OK before item 2 starts.

Ready for the baseline:
- `.md` reader: `parseTaskMarkdown(text)` in `lib/agent/runner.ts`, selected by the `.md` extension in `scripts/agent-run.ts`. Unit test with inline strings only: two sections parse to `{id, prompt, starter}` (notes dropped, intro text ignored); a section without a prompt or with an empty one fails as `Task <id> needs a prompt.`; an unknown starter, a duplicate id and a file with no sections each fail with a clear message.
- Evidence: `bun run typecheck` + `bun run test` run 1: pass (86), run 2: pass (86). `scripts/agent-run.ts` bundles (`agent-run.mjs 41.44 KB`).
- Baseline columns: Anthropic live. OpenAI is marked skipped until `OPENAI_EVAL_API_KEY` exists. Recorded from generic verify only: typecheck, build, runtime errors, whether the visual check ran or was skipped, pass^k on those, cost per completed task, cache hit ratio, p50/p95 turn latency, tokens per turn. Quality grading is left empty for the founder.

## Folded-in orchestrator items

- Errors item: `/api/chat` calls `sandboxMessage(error)` in its `openProject` catch.
- Loop control item: the UI treats `TurnStatus` `'unverified'` as not a pass.
- Settings item: the settings schema lives in one exported module the DB worker (branch `db`, Supabase + Drizzle, `user_settings`) can import; localStorage until then.

## Questions for the founder

Answered 2026-11-18 (via orchestrator):

1. **Task file:** `evals/tasks/sample.md`, written by the founder. Don't create it. The baseline waits for the orchestrator's message that it is in the repo. **Open: still missing.**
2. **Format:** one task per `## <task id>` section with `prompt:` (one line), `starter:` (default if omitted) and `notes:` (for the founder; the runner ignores it). A section without a prompt fails with its task id and is never skipped. The runner grades nothing from this file. Done: `parseTaskMarkdown` in `runner.ts`; `agent:run --tasks <file>.md` uses it, and `.json` still works.
3. **No-retry:** in the harness, not the system prompt. A policy denial's tool result says it was denied by policy, gives the reason and says not to retry the same call. `system-prompt.ts` stays frozen. Lands in the Approvals and policy item.
4. **OpenAI:** no eval key yet. Build and unit-test the OpenAI adapter against a fake endpoint, mark live OpenAI runs as skipped in the baseline, and read `OPENAI_EVAL_API_KEY` when it appears. Don't ask for it. **Cost:** per turn, from the provider's usage fields (input, output, cache read, cache write) times a price table in the model registry. Prices live in one file, each with its date and official pricing page, and the turn record keeps the price version it used. No billing API calls. Lands in the Context (registry) and Turn record v2 items.

Orchestrator observation (for Turn record v2): in the live hero test (traces `0908fd6bb978ce23837b1b5d2559b545`, `e20ce2b9a87b5e8831377feca36e444d`) the `betterlook.turn` observation had an empty output in Langfuse, so the turn record, including sandbox CPU, can't be read back from the v2 observations API (Langfuse removed `GET /api/public/traces` on 2026-11-16). The turn record must land somewhere it can be read back. Turn-two cache reads were 0 on every step (no breakpoints yet, a prefix of about 1k tokens). That matches the audit risk, and the Request shape and caching item measures it.

## Round log

- Round 2b (2026-11-18): recorded founder answers Q1-Q4 and the orchestrator's Langfuse observation; built the `.md` task reader with an inline-string test. BLOCKED on the task file.
- Round 2 (2026-11-18): merged `betterlook` (`a106f753` .env.example names). Wrote the audit table. Baseline BLOCKED: task file missing (Q1), format (Q2), OpenAI eval key and price source (Q4).
- Round 1 (2026-11-18): merged `betterlook` (fast-forward to `60528b79`, includes S01). Created this file. Stopped as the loop prompt says.

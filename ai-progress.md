# AI-CORE progress

Worker: AI-CORE (the AI layer). Branch: `ai-core`. Dev server port 3400.

## Checklist

- [x] Plan: use the agent-reach skill to compare E2B, Vercel Sandbox and Daytona (isolation, preview URL, file API, git support, startup time, cost). Write the comparison, your pick, the runAgent() flow in 5-10 lines, and a draft of lib/agent/types.ts (committed as the real file). Ask the founder: which sandbox, which first provider, and where the user's key lives (default: in the browser, sent per request, used for that call only, never stored server-side). Stop and wait.

  Founder answers (2026-11-18, via orchestrator): sandbox **Vercel Sandbox**; first provider **OpenAI via `@ai-sdk/openai`** (Responses API, `store: false`, keeps `oauth` usable for ChatGPT sign-in); Anthropic is the "second provider is a small change"; user key in the browser, per request, never stored or logged server-side; no `.env` yet, so live proofs are marked LIVE PROOF PENDING ENV and listed under Pending e2e.

  Research: Sources: e2b.dev/pricing, docs.e2b.dev/billing, github.com/e2b-dev/infra ARCHITECTURE.md, vercel.com/docs/sandbox/pricing, vercel.com/docs/sandbox (concepts + working-with-sandbox + SDK reference), daytona.com/pricing, daytona.com/docs/preview, daytona.com/docs/file-system-operations. Gathered with agent-reach (Exa search), 2026-11-18.

  | | E2B | Vercel Sandbox | Daytona |
  |---|---|---|---|
  | Isolation | Firecracker microVM, own cgroup + netns | Firecracker microVM, dedicated kernel | VM with hardware isolation, dedicated kernel (OCI images) |
  | Preview URL | public host per port (`getHost(port)`) | public URL per exposed port (`sandbox.domain(port)`), up to 15 ports | per-port preview URL; private by default, needs a token header or a signed URL (iframe needs the signed form) |
  | File API | `files.read/write/list` (no shell) | `writeFiles`, `readFile`, `mkDir` | fs module (upload/download/list), no shell |
  | Git | via commands; git in base image | `source: {type: 'git'}` on create; git via `runCommand` | native Git API with credential handling |
  | Startup | resumes pre-booted microVMs, ~0.2 s measured in a third-party benchmark | "milliseconds"; snapshot resume faster; persistent sandboxes auto-snapshot on stop and resume on next call | "sub 90 ms" (vendor claim) |
  | Cost | $0.000014/vCPU-s + $0.0000045/GiB-s (~$0.11/h for 2 vCPU + 0.5 GiB); Hobby $100 one-time credit, 1 h max continuous run; Pro $150/mo, 24 h | Active CPU $0.128/h (idle CPU not billed) + $0.0212/GB-h memory; Hobby free quota (5 CPU-h, 45 min sessions); Pro 24 h sessions | $0.101/core-h on demand (1 core = 2 vCPU) + $0.0162/GiB-h; $200 one-time credit; 24 h sessions |

  **Pick: Vercel Sandbox.** A dev server idling in the preview between edits costs memory only (Active CPU billing). Persistent-by-default sandboxes snapshot on stop and resume on the next SDK call, which is exactly "reload reconnects to the same sandbox" with no code of ours. Public per-port URLs drop straight into the preview iframe (Daytona needs signed URLs). One SDK (`@vercel/sandbox`) next to the AI SDK. Close second: E2B (cheaper per second, but 1 h max run on Hobby). Risk: Hobby's 45 min session cap; fine for dev, Pro for real use.

  **runAgent() flow:**
  1. `runAgent({prompt, history, model, credential, sandboxId, abortSignal, onEvent})` in `lib/agent/run.ts`, called by `/api/chat` and by `scripts/agent-run.ts`.
  2. Build the model from `credential` (`@ai-sdk/openai`, per-request `createOpenAI({apiKey})`, Responses API with `store: false`), hash the system prompt and tool config.
  3. `streamText({model, instructions, messages, tools, stopWhen: isStepCount(config.maxSteps), maxOutputTokens, providerOptions, telemetry})` (AI SDK v7 names).
  4. Each tool's `execute` first calls `checkPolicy(tool, args)`: deny returns a tool error to the model and records a `DeniedCall`; a protected path emits `awaiting-approval` and waits for approve/deny.
  5. On finish: `git commit` in the sandbox, giving the `Checkpoint`; run verify (tsc, build, preview console/page errors).
  6. If verify fails: one repair `streamText` with the errors, commit again, verify again; still failing means status `failed`, restore offered.
  7. Assemble the `TurnRecord` (diff, files touched, usage, cost, hashes), mask secrets, send to Langfuse via the AI SDK OpenTelemetry export, return it.

  **types.ts draft:** committed as `apps/web/src/lib/agent/types.ts` (the real file).

  Evidence: `bun install --frozen-lockfile` (lockfile unchanged), then `bun run typecheck` run 1: pass, run 2: pass. No `.env` exists yet, so there is no secret to grep for.

- [x] Agent core, text only: lib/agent/types.ts committed; runAgent() streams replies into the chat panel; model picker, stop button and step limit work.

  Built: `lib/agent/run.ts` (`runAgent()`: one `streamText` with `instructions`, `isStepCount(maxSteps)`, `maxOutputTokens`, `providerOptions.openai.store = false`, abort signal), `lib/agent/config.ts` (controls file: `maxSteps` 20, `maxOutputTokens` 8000; allowlist and path policy join it in later items), `lib/agent/system-prompt.ts` (**founder slot**: `SYSTEM_PROMPT = ''`, empty sends no instructions), `lib/agent/model.ts` (`providerOf`, `languageModel(modelId, credential)` via `createOpenAI`, `parseCredential` shape check), `app/api/chat/route.ts` (credential is `parseCredential(body.credential) ?? await getServerCredential(req)`, using the one-line stubs for AUTH in `route.ts` and `Workspace.tsx`), and `Workspace.tsx` minimal change: `useChat` with a `Chat` owned by the component (useChat's own instance is stopped by StrictMode's simulated unmount, which silently dropped the first send), real messages, plain error line, Stop button while busy. The landing prompt is sent once on mount with the picked model.
  Deps: `@ai-sdk/openai@4.0.121` (first provider), `@ai-sdk/react@4.0.180` (`useChat`, pinned to `ai@7.0.176`), `@types/bun@1.4.4` dev (types for `bun:test`; TS 6 defaults `types` to empty, so the test file references them, and `tsconfig.json` is untouched). Scripts: `test` (`bun test`) in root and web `package.json`.
  Evidence:
  - `bun run typecheck` and `bun run test`, run 1: pass, run 2: pass (5 tests, `ai/test` `MockLanguageModelV4`): reply streams with configured `maxOutputTokens` and `store: false`; abort stops the stream mid-reply; a model that keeps calling tools stops at exactly `maxSteps` (20) steps; model-to-provider routing and mismatch rejection; credential shape validation (`api-key`, `oauth`, empty key, wrong provider, null).
  - UI at :3400 with `/api/chat` mocked in the browser: `.screenshots/agent-core-reply-1440.png` (landing prompt plus streamed reply, GPT-5 label), `.screenshots/agent-core-stop-visible-1440.png` (Stop shown while pending), `.screenshots/agent-core-stopped-1440.png` (Stop clicked, request aborted, chat idle). Request bodies: `[{"model":"gpt-5","credential":null,"messages":1},{"model":"gpt-5","credential":null,"messages":3}]`.
  - UI against the real route (no mock): `.screenshots/agent-core-unconnected-model-1440.png` ("claude-sonnet-5-5 is not connected yet."), then picker switched to GPT-5 and sent: `.screenshots/agent-core-real-route-errors-1440.png` ("Sign in or add an API key to start."). Requests carried `["claude-sonnet-5-5","gpt-5"]` (the picker drives the model); server log `POST /api/chat 400`, then `401`; the chat kept working after the error.
  - React Doctor 100/100. No `.env` exists; `grep -rIE "sk-[A-Za-z0-9_-]{16,}" .screenshots apps/web/src` found no match.
  - LIVE PROOF PENDING ENV: with an OpenAI key in the credential, send "hello" from `/workspace?model=gpt-5` and see a streamed reply, then press Stop mid-stream and see the server request abort.
  - Known gap: a reload re-sends the landing prompt. Chat history and sandbox id move to localStorage in the Sandbox item.
- [x] BYOK: the key flows the way the founder picked; missing or wrong key shows a clear message.

  How the key flows: the browser sends `credential` in the `/api/chat` body (from AUTH's `getCredential()`, stubbed to null until it lands). The server resolves `parseCredential(body.credential) ?? await getServerCredential(req)`, builds `createOpenAI({apiKey})` for that one call, and keeps nothing. The ChatGPT OAuth cookie path is AUTH's `getServerCredential`, also stubbed.
  Built: `lib/agent/errors.ts`, which maps provider errors to fixed messages (401/403: "Your API key or sign-in was rejected. Check it and try again."; anything else: "The model provider returned an error. Try again."). Provider text is never forwarded, because OpenAI's 401 body echoes part of the key. The route passes `onError: userMessage` to `toUIMessageStream`; `runAgent` sets `streamText` `onError` to log only `[agent] model call failed: <status>`, which replaces the SDK default that console-logs the whole error, including the response body.
  Evidence:
  - `bun run typecheck` + `bun run test` run 1: pass, run 2: pass (7 tests). New: provider error mapping (401, 403, 500, plain Error); a mock model throwing a 401 whose body echoes a fake key reaches the UI stream as `{type: 'error', errorText: KEY_REJECTED}`, the chunks never contain the fake text, and the only log line is `['[agent] model call failed:', 401]`.
  - Wrong key, live against OpenAI with a dummy string injected into the request body by the test browser: `.screenshots/byok-wrong-key-1440.png` shows "Your API key or sign-in was rejected. Check it and try again."; server log `[agent] model call failed: 401`, `POST /api/chat 200`.
  - Missing key: `.screenshots/byok-missing-key-1440.png` shows "Sign in or add an API key to start." (`POST /api/chat 401`), sent after the error, so the chat keeps working.
  - The dummy key string appears 0 times in the dev server log. No `.env` exists; the secret-pattern grep over `.screenshots/*.log` and `apps/web/src` found no match.
  - LIVE PROOF PENDING ENV: with AUTH's real `getCredential()` and a valid OpenAI key, a reply streams; with the key removed, "Sign in or add an API key to start." shows; with a revoked key, the rejected message shows.
- [x] Turn record and tracing: each turn lands in Langfuse with the required fields; prompt and tool config hashes change on edit; no secret appears in an exported trace.

  Built: `lib/agent/trace.ts`, holding `hashOf` (sha256, 16 hex chars), `maskSecrets` (every env value whose name contains KEY/TOKEN/SECRET/PASSWORD, plus `sk-…`, JWT and `Bearer …` patterns), and `MaskingSpanProcessor`, which masks every span attribute and event before any exporter sees it. `setupTelemetry(processor)` registers a `NodeTracerProvider` plus the AI SDK v7 `OpenTelemetry` integration. When `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are set, `trace.ts` wires `LangfuseSpanProcessor` itself, with the same mask and an export filter covering our `betterlook` spans and gen_ai spans; `flushTraces()` is for the CLI. `runAgent()` now returns `{result, turn}`: it opens a `betterlook.turn` root span, runs `streamText` inside it so the AI SDK spans (`invoke_agent`, `step`, `chat`, tool spans) nest under one trace, and resolves `turn` with a `TurnRecord` on end, abort or error. `trace.id`, `systemPromptHash = hashOf(SYSTEM_PROMPT)`, `toolConfigHash = hashOf(AGENT_CONFIG)` and status go into Langfuse trace metadata, and the masked record is the trace output. `apps/web/.env.example` lists the Langfuse vars, all empty.
  Fields filled now: trace id, provider/model, both hashes, usage (input, output, cached input), status, timing. Filled by later items: tool calls with allowed/denied and timing (Tools), diff, files touched, checkpoint id, verify, repair (Sandbox, Checkpoint and verify). Cost: `costUsd` stays null, because Langfuse prices the gen_ai spans from model and usage. I did not add a price table.
  Deps: `@ai-sdk/otel@1.0.176` (v7 moved OpenTelemetry out of `ai`), `@langfuse/otel@6.1.1` (Langfuse span processor), `@opentelemetry/api@1.9.1` (the version `@ai-sdk/otel` pins), `@opentelemetry/sdk-trace-node@2.12.0` (tracer provider with async context), `@opentelemetry/sdk-trace-base@2.12.0` (`SpanProcessor` types, plus `InMemorySpanExporter` in tests; a Langfuse peer).
  Evidence:
  - `bun run typecheck` + `bun run test` run 1: pass, run 2: pass (10 tests). `trace.test.ts`: masking of env values, `sk-` keys, Bearer and JWT; the hash changes when the prompt text or any config field changes and is stable for equal config; one mock turn produces a record (hashes, `usage {12, 5, cached 10}`, status `passed`), every exported span shares the record's trace id, and a user key plus an env secret echoed in both prompt and reply appear nowhere in the exported spans (`[REDACTED]` present).
  - Span tree from one mock turn: `betterlook.turn` root, then `invoke_agent mock-model-id`, `step 1`, `chat mock-model-id`, all children in the same trace. Trace output excerpt: `{"id":"5fbf…","traceId":"ad7fb5d1…","prompt":"make the hero heading blue","provider":"mock-provider","model":"mock-model-id","systemPromptHash":"12ae32cb1ec02d01","toolConfigHash":"010f921decab760a","toolCalls":[],"usage":{"inputTokens":3,"outputTokens":2,"cachedInputTokens":0,"costUsd":null},…,"status":"passed",…}`.
  - The route still works under Next with telemetry imported: BYOK browser check reran, `[agent] model call failed: 401`, `POST /api/chat 200`, then `401`.
  - No `.env` exists; the secret grep found no match (above).
  - LIVE PROOF PENDING ENV: with Langfuse keys and an OpenAI key in `apps/web/.env`, send one message; the Langfuse trace shows `betterlook.turn` with nested model spans, metadata `systemPromptHash`/`toolConfigHash`, the turn record as output, and computed cost. Then edit `system-prompt.ts`, send again, and the `systemPromptHash` differs. Export the trace JSON and grep it for each `.env` value: no match.
- [ ] Sandbox and preview: a fresh sandbox from a minimal React starter, initialized as a git repo; the preview shows it; reload reconnects to the same sandbox.
- [ ] Tools and policy: the allowlisted tools work; a call outside the project folder is denied, logged and returned to the model as a tool error; a package.json edit pauses for approval.
- [ ] Checkpoint and verify: commit per turn, verify after each turn, one repair attempt, failed-turn state, restore works, events logged.
- [ ] Headless runner: agent:run on a two-task sample file from the founder produces complete run folders, 2 runs each, through the same runAgent().
- [ ] End to end: "make the hero heading blue" from the landing screen edits the code, verify passes, the preview turns blue, and the trace has every tool call, the diff and the checkpoint id.
- [ ] Failure states: rate limit, provider error, sandbox down, denied tool, failed verify and step limit each show a readable message, and the chat keeps working.

## types.ts changes

- v1 (Plan item): `ProviderCredential` (`api-key` | `oauth` with `accessToken`), `ProviderId`, `ToolName`, `DeniedCall`, `ToolCallRecord`, `VerifyCheck`, `VerifyResult`, `Checkpoint`, `Usage`, `TurnStatus`, `TurnRecord`, `TurnEvent` (restore, keep, approve, deny). AUTH: an OAuth token goes in `{kind: 'oauth', accessToken}`; `ProviderId` widens when a second provider lands.
- Dependency (orchestrator request, 2026-11-18): `ai@7.0.176` (exact) added to `apps/web/package.json`. This is **v7**, not v5: npm `latest` is 7.0.176, and v5 (5.0.291) and v6 are maintenance tags. `import type {UIMessage, ToolUIPart} from 'ai'` typechecks. The founder's brief named v5; the APIs it names (`streamText`, tools, `stopWhen` + `stepCountIs`, `useChat`) carry through v7, and `useChat` comes from `@ai-sdk/react`, which lands with the Agent core item. No provider package or sandbox SDK added. Evidence: `bun run typecheck` run 1: pass, run 2: pass.

- `0dccdb9a` (orchestrator priority, for AUTH): `ProviderId = 'openai' | 'anthropic'`. OpenAI is the first provider; `anthropic` is reserved for the second.

- Allowed models (orchestrator correction): `apps/web/src/lib/agent/models.ts` exports `MODELS: {id, label, provider}[]` as plain data, safe to import on the client (type-only import of `ProviderId`). OpenAI default first: `gpt-5.5`, then `gpt-5` (both are ids `@ai-sdk/openai@4.0.121` knows; founder can edit the list). `/api/chat` rejects any model not in it (`providerOf` looks it up). AI-UI's picker imports it; `composer/` is untouched.

- Tracing item: `TurnRecord.provider` is now `string`, the AI SDK provider id such as `openai.responses`, instead of `ProviderId`. `runAgent()` returns `{result, turn}`, where `turn` is a `Promise<TurnRecord>`.

## Questions for the founder

Answered 2026-11-18 (see Plan). Open:

- Resolved: the picker default moves to AI-UI importing `lib/agent/models.ts` (see types.ts changes). Until AI-UI wires it, `Workspace.tsx` still seeds from `composer/models.ts`, so a non-OpenAI pick shows "<model> is not connected yet."

Original questions:

1. **Sandbox:** Vercel Sandbox (my pick), E2B or Daytona? I need a Vercel team token (or OIDC via `vercel link`) in `.env` as `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`. I won't create the account.
2. **First provider:** Anthropic via `@ai-sdk/anthropic` (my pick: explicit prompt caching through `cacheControl`, and the picker already defaults to Claude), or OpenAI via `@ai-sdk/openai` (fits a ChatGPT-subscription credential if AUTH lands one)? Either way the second provider is one entry in a provider map.
3. **Where the user's key lives:** I'll use your default unless you say otherwise: in the browser (localStorage), sent per request in a header, used for that call only, never stored, logged or traced server-side.
4. **Eval key and Langfuse:** for later items I need, in `.env` (never shown to me in chat): `ANTHROPIC_EVAL_API_KEY` (or the OpenAI equivalent), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
5. **System prompt slot:** this will be `apps/web/src/lib/agent/system-prompt.ts`, a one-line placeholder for you to fill in. It lands with the Agent core item.

## Pending e2e

Live checks that need the founder's `.env` (OpenAI eval key, Vercel token, Langfuse keys).

- Tracing: a Langfuse trace per turn with nested model spans, hashes in metadata, record as output, cost computed; hash changes after a prompt edit; exported trace JSON has no `.env` value.
- BYOK: valid key streams; missing key and revoked key show the two messages (needs AUTH's `getCredential()` and a real key).
- Agent core: streamed reply from a real OpenAI model at `/workspace?model=gpt-5`; Stop aborts the server request.

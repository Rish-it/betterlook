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
- [x] Sandbox and preview: a fresh sandbox from a minimal React starter, initialized as a git repo; the preview shows it; reload reconnects to the same sandbox.

  Built: `lib/sandbox/starter.ts` (a minimal Vite + React + TS app: hero heading, copy and button; `dev`, `build` and `typecheck` scripts; dev server on 5173 with `allowedHosts: true` and `cors: true`). `lib/sandbox/sandbox.ts`:
  - `createSandbox()`: Vercel Sandbox `node24` with port 5173 → writes the starter → `npm install` → `git init` plus a local identity → `git add -A` → `git commit -m starter`, which includes the lockfile → `npm run dev` detached → returns `{sandboxId, previewUrl}`.
  - `connectSandbox(id)`: `Sandbox.get({name, resume: true, onResume})`, which restarts the dev server when a stopped sandbox resumes.
  - Credentials: `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID`, or OIDC. Nothing from our env is passed into the sandbox.
  `app/api/sandbox/route.ts`: POST `{sandboxId}` reconnects, or creates a fresh sandbox if the old one is gone. It returns 503 "The preview sandbox is not configured yet." without credentials, and 502 "The preview sandbox could not start. Reload to try again." on failure; the log carries the message only.
  `Workspace.tsx` (minimal): one sandbox request per page load; sandbox id and chat history in localStorage (`betterlook.sandboxId`, `betterlook.chat`). Arriving with `?prompt=` starts a new project: storage is cleared, the prompt is sent, and the URL is rewritten to `/workspace?model=…`, so a reload restores the history and reconnects instead of re-sending. The iframe shows the sandbox URL, and an error shows in the preview toolbar.
  Fixed on the way:
  - **Shell bug:** the preview section's `display: flex` was wiped on desktop by `hiddenWhenNarrow` (`display: {default: null}`), so the iframe stayed at the 150px default height. `previewHiddenWhenNarrow` now keeps `flex` on desktop and `none` when narrow.
  - **Iframe scripts:** the opaque-origin iframe (`sandbox` without `allow-same-origin`) needs Vite `cors: true` to load module scripts.
  Dep: `@vercel/sandbox@4.0.0` (the founder's sandbox pick).
  Evidence:
  - `bun run typecheck` + `bun run test` run 1: pass, run 2: pass (15 tests). `sandbox.test.ts` with a fake Sandbox API checks four things:
    - the exact create sequence (create → write all starter files → install → git init/config/add/commit → detached dev);
    - a failed `npm install` stops before git;
    - reconnect calls `get(name, resume: true)` and restarts dev;
    - the route returns 503 when not configured.
  - Starter, real run in the scratchpad: `npm install` (23 packages), `git commit` gives `9e3a91e starter`, `npm run typecheck` passes, `npm run build` passes (`dist/assets/index-*.js 219.81 kB`), `vite` serves it.
  - Real SDK under Next with deliberately fake Vercel vars: `[sandbox] start failed: Status code 403 is not ok: Not authorized`, `POST /api/sandbox 502`. The fake token appears 0 times in the log.
  - UI, with `/api/sandbox` answered by the test browser pointing at the local starter: `.screenshots/sandbox-preview-1440.png` (starter rendered full height in the preview; URL rewritten to `/workspace?model=gpt-5`); `.screenshots/sandbox-reload-reconnect-1440.png` (after reload, history restored, same model, preview back). Sandbox request bodies: `[{"sandboxId":null},{"sandboxId":"sbx-local-1"}]`; `/api/chat` called once in total, so the reload did not re-send.
  - Unconfigured, real route: `.screenshots/sandbox-not-configured-1440.png` (toolbar reads "The preview sandbox is not configured yet.", placeholder kept).
  - Narrow 390px: `.screenshots/sandbox-narrow-chat-390.png` (preview hidden), `.screenshots/sandbox-narrow-preview-390.png` (chat hidden, starter rendered).
  - React Doctor 73/100, one warning: `no-fetch-in-effect` (Workspace.tsx sandbox effect). **Waived with evidence:** the rule's own page says "Suppress when: a one-shot fetch with proper cleanup in a small project that has not adopted a data-fetching library". The request is one-shot, deduplicated per page load (one request per load under StrictMode, shown above), and its state update is guarded on unmount. It is not aborted on purpose, since aborting would cancel sandbox creation. Adding react-query for one call goes against minimal deps. The two other warnings it raised (unguarded async set-state; `.then` without catch) are fixed.
  - Secret-pattern grep over `.screenshots/*.log` and `apps/web/src`: the only hit is `trace.test.ts`, whose `sk-proj-userkeyABCDEF123456` is the made-up key the masking test proves gets redacted. No `.env` exists.
  - LIVE PROOF PENDING ENV: with Vercel credentials, open `/` and send a prompt. `/api/sandbox` creates a sandbox, the preview iframe shows the starter from `*.vercel.run`, and `git log` in the sandbox shows `starter`. Reload `/workspace`: the same `sandboxId` is sent and the same preview returns. Stop the sandbox, then reload: it resumes and the dev server restarts.
  - Fragile, noted for the runner item: `@vercel/sandbox` cannot load under Bun (Bun's built-in `undici` lacks `Dispatcher1Wrapper`); it loads under Node, so Next is fine. `sandbox.ts` imports it lazily so Bun tests inject a fake. `agent:run` will need to run under Node.
- [x] Tools and policy: the allowlisted tools work; a call outside the project folder is denied, logged and returned to the model as a tool error; a package.json edit pauses for approval.

  Built:
  - **`lib/agent/config.ts`, the one controls file:** `maxSteps`, `maxOutputTokens`, `tools` allowlist (`list_files`, `read_file`, `search`, `edit_file`, `write_file`, `typecheck`; no shell, web or installs), `deniedPaths` (`.git`, `node_modules`), `approvalFiles` (`package.json`, `package-lock.json`, `*.lock`, `pnpm-lock.yaml`, `tsconfig*.json`, `*.config.*`, `.env*`, matched on file name at any depth), `maxToolOutputChars`, `promptCachePerProject`.
  - **`lib/agent/policy.ts`, the single check:** `checkPolicy(tool, input, root)` returns allow, approve or deny. It denies non-allowlisted tools, any path that resolves outside the project root, and `.git`/`node_modules`. Writes and edits to protected files return approve.
  - **Where it runs:** `runAgent` passes it to the AI SDK as one generic `toolApproval` function, so it runs before every tool call. Deny → `{type: 'denied', reason}`: the model gets a denied tool output carrying the reason, the server logs `[policy] denied: <tool> <reason>` (no args), the turn records a `DeniedCall` with `decision: 'denied'`, and the stream writes a `data-denied` part. Approve → `'user-approval'`: the turn pauses on the SDK's `tool-approval-request`, the stream writes `data-approval` (path plus proposed diff), and the status becomes `awaiting-approval`. The next request carrying the approval response runs the tool (`decision: 'approved'`); a denial leaves the file alone and the model gets the user's reason.
  - **`lib/agent/tools.ts`:** JSON-schema tools via `jsonSchema` from `ai` (no zod). `edit_file` replaces one exact, unique match or explains 0 or N matches. Output is clipped. Each call is recorded with args, result or error, decision, start time and duration. `TOOL_DEFINITIONS` (descriptions and schemas) feeds the hash: `TOOL_CONFIG_HASH = hashOf({config: AGENT_CONFIG, tools: TOOL_DEFINITIONS})`, so editing either changes it.
  - **`lib/sandbox/project.ts`:** `Project` interface plus `sandboxProject(sandbox, root)`, which runs `find` and `grep` with argument arrays, not a shell. `openProject(sandboxId)` roots the project at the sandbox's own `cwd`.
  - **Prompt caching:** OpenAI caches automatically; `promptCacheKey` is set to the sandbox id so turns on one project share a cache.
  - **`/api/chat`:** opens the project from `body.sandboxId` when the sandbox is configured (503 "The preview sandbox is not reachable. Reload to try again." if it cannot), and serves `agentUIStream()`, which merges the model stream with the data parts.
  - **`lib/agent/client.ts`:** `createAgentChat({getCredential, getSandboxId, messages?})`, a `Chat<AgentMessage>` whose body sends `credential` and `sandboxId` and whose `sendAutomaticallyWhen` continues once approvals are answered. AI-UI approves or denies with `chat.addToolApprovalResponse({id, approved, reason?})`.
  Evidence:
  - `bun run typecheck` + `bun run test` run 1: pass, run 2: pass (22 tests). `tools.test.ts`, with a mock model against a real temp folder:
    - **policy table:** inside allowed; `../secrets`, `/etc/passwd`, `src/../../x` and a sibling-prefix path denied; `.git` and `node_modules` denied; 7 protected names → approve for both write and edit, at any depth; a read of `package.json` is allowed; an unknown tool is denied as `not-allowlisted`.
    - **`edit_file`:** single, zero and multiple matches, plus a `$&` replacement kept literal.
    - **One turn calling four tools:** `list_files` returned `package.json\nsrc/App.tsx`, `search` found `src/App.tsx:1:`, `edit_file` changed the file on disk, and `read_file ../../etc/passwd` was denied. Records are `[c4 denied, c1/c2/c3 allowed]` with timing; exactly one `data-denied` chunk; warn log `['[policy] denied:', 'read_file', 'outside-project']`. The model's next prompt holds "../../etc/passwd is outside the project folder." and "Edited src/App.tsx."; provider options `{store: false, promptCacheKey: 'sbx-local'}`.
    - **`write_file package.json`:** status `awaiting-approval`, no tool record, file unchanged, `data-approval` with the diff. After the approval response is appended: file written, record `[p1 approved]`, status `passed`.
    - **User denial:** the file is unchanged and the model's prompt holds "User denied the edit."
    - **The served stream (`agentUIStream`):** carries `data-denied`, `data-approval`, `tool-output-denied` and `tool-approval-request`.
  - `sandbox.test.ts`: `openProject` resumes the sandbox, restarts dev, and roots at the sandbox `cwd`.
  - Live route after the refactor (BYOK browser check): `[agent] model call failed: 401`, `POST /api/chat 200`, then `401`.
  - No screenshot of tool activity or approval buttons: `Workspace.tsx` belongs to AI-UI now (orchestrator), and AI-UI renders the `tool-*`, `data-denied` and `data-approval` parts. The data contract is proven at the stream level above.
  - No `.env`; the secret-pattern grep only hits the masking fixture in `trace.test.ts`.
  - LIVE PROOF PENDING ENV: with OpenAI and Vercel credentials and AI-UI's chat wired through `createAgentChat`:
    1. Ask "read src/App.tsx and make the heading blue": `read_file` and `edit_file` run in the sandbox and the preview updates.
    2. Ask "read /etc/passwd": the denial appears as a `data-denied` part, the model explains it, and the server log shows `[policy] denied: read_file outside-project`.
    3. Ask "add lodash to package.json": the turn pauses with a `data-approval` diff; Approve writes it, Deny leaves it.
- [x] Checkpoint and verify: commit per turn, verify after each turn, one repair attempt, failed-turn state, restore works, events logged.

  Built: `runAgent()` now owns the whole turn and returns `{stream, turn}`, one `createUIMessageStream` used by both `/api/chat` and the CLI:
  1. **Model call.** If it ends on a pending approval, the status is `awaiting-approval` and nothing is committed. If there is no project, it ends `passed`.
  2. **`commitTurn`** (`lib/agent/checkpoint.ts`): `git add -A`, diff and files against the turn's base, `git commit --allow-empty -m "turn <id>"`. The stream gets `data-checkpoint` (`id`, `parentId`) and `data-diff`.
  3. **`verifyProject`** (`lib/agent/verify.ts`), then a `data-verify` part (id `verify`):
     - `typecheck` (`npm run typecheck`) and `build` (`npm run build`), each `passed` or `failed` with the last 40 output lines;
     - `runtime`: a headless Chromium checker inside the sandbox (`lib/sandbox/runtime-check.ts`, installed at sandbox creation under `/tmp/betterlook`) loads `localhost:5173` and reports console errors and page errors. It is `skipped` when the build failed, and `skipped` with the reason when the checker itself cannot run, so infrastructure trouble never counts against the agent.
  4. **If verify failed, exactly one repair:** a second model call with the history plus `REPAIR_PROMPT` filled with the failing checks' errors (a founder slot in `system-prompt.ts`, included in `systemPromptHash`). Then a second commit against the same base (`data-checkpoint` and `data-diff` replaced), a second verify (`data-verify` id `repair-verify`), and status `passed` or `failed`. There is no further loop.
  5. **Errors:** a sandbox or git failure mid-turn sets the turn to `error` and streams "The preview sandbox stopped responding. Reload to try again."
  - **Restore:** `restoreCheckpoint(project, id)` runs `git read-tree -u --reset <id>` plus a commit `restore <id>`. History stays linear, so every checkpoint, including later ones, stays restorable. The id is validated as a hex sha.
  - **Events (`lib/agent/events.ts` `logEvent`):** one `[event] {json}` log line plus a `betterlook.event.<type>` span joined to the turn's trace when `traceId` is known.
    - approve/deny: logged server-side from the approval responses in the incoming request;
    - restore: `POST /api/restore` logs it;
    - keep: `POST /api/events`, which accepts keep only.
  - Message metadata on the assistant message: `{turnId, traceId}`.
  Evidence:
  - `bun run typecheck` + `bun run test` run 1: pass, run 2: pass (51 tests, including AUTH's). `turn.test.ts` runs a mock model on a temp project with real git and scripted npm/node:
    - **Clean turn:** status `passed`; the checkpoint is the new HEAD and its parent is the starter; commit `turn <id>`; `filesTouched ['src/App.tsx']`; the diff holds the edit; checks typecheck, build and runtime all `passed`; data parts arrive in order checkpoint, diff, verify; the stream ends with `finish`.
    - **First typecheck fails:** exactly 4 model calls; the repair prompt holds the TS error; `repairAttempted`, `verify.ok=false`, `repairVerify.ok=true`, status `passed`; the checkpoint parent is still the starter; the log shows two turn commits; verify parts `verify` and `repair-verify`.
    - **Build always fails:** exactly 3 model calls (the 4th scripted reply is never used), status `failed`, runtime `skipped`.
    - **Restore:** restoring to `parentId` gives back the starter file and a `restore <sha>` commit; restoring forward to the checkpoint brings the edit back; `HEAD; rm -rf /` is rejected.
    - **Runtime parser:** passed, failed with errors, and skipped when the checker cannot run. The repair message lists only failed checks.
    - **Routes:** keep through `/api/events` returns 204 and logs `{type: 'keep', turnId, traceId}`; other types get 400. `/api/restore` returns 400 on missing fields and 503 when unconfigured.
  - `tools.test.ts` now drives approval through the real UI message (`approval-requested` → `approval-responded` → `convertToModelMessages`) and checks the server-side `approve` and `deny` event logs.
  - **Real verify on the local starter** (real `tsc`, real `vite build`, the real checker script in headless Chromium against the running dev server):
    - `clean true [typecheck passed, build passed, runtime passed]`
    - `runtime-error false [typecheck passed, build passed, runtime failed "hero exploded"]`
    - `syntax-error false [typecheck failed "src/App.tsx(8,3): error TS1005: '>' expected.", build failed "✗ Build failed", runtime skipped]`
  - No screenshot: rendering verify, restore and keep is AI-UI's job, and the stream contract is proven above.
  - No `.env`; the secret-pattern grep only hits the masking fixture in `trace.test.ts`.
  - LIVE PROOF PENDING ENV:
    1. In a real Vercel sandbox, sandbox creation installs the checker (`playwright install --with-deps chromium` with sudo) and the runtime check loads `localhost:5173` inside the sandbox.
    2. One UI turn shows the checkpoint, diff and verify parts.
    3. A broken edit triggers exactly one repair.
    4. Restore through `restoreCheckpoint()` reverts the preview, and `[event] restore` appears in the log and in the Langfuse trace.
  - Fragile: the checker install adds Chromium and its system libraries to sandbox creation (slow, and needs `sudo` in the sandbox image). Whether `/tmp/betterlook` survives a persistent-sandbox stop and resume is unverified; if it does not, the runtime check reports `skipped`, not `failed`.
- [x] Headless runner: agent:run on a two-task sample file from the founder produces complete run folders, 2 runs each, through the same runAgent().

  Built to the orchestrator's "interfaces first" rule; no task file is committed and no task prompts were written.
  - **CLI:** `bun run agent:run --tasks <file.json> --runs <k> [--concurrency n] [--model id] [--out dir]` works from the repo root or `apps/web`, with paths relative to where you run it. Bun bundles `apps/web/scripts/agent-run.ts` and Node runs it (`node --env-file-if-exists=.env`), because `@vercel/sandbox` cannot load under Bun.
  - **Task file:** JSON `[{"id", "prompt", ...}]`, checked by `parseTasks`: non-empty array, filesystem-safe unique ids, a prompt for each. Extra fields pass through untouched into `task.json`.
  - **Core (`lib/agent/runner.ts` `runTasks`):** runs every task k times through a worker pool capped at `RUNNER_CONFIG.concurrency` (2). Each run gets a fresh sandbox (`createSandbox` → `openProject`), a before screenshot, the same `runAgent()` the chat uses, then an after screenshot.
  - **Run folder:** `<out>/<task id>/run-<n>/` holds `task.json`, `turn.json` (the full TurnRecord), `diff.patch`, `verify.json` (verify, repairAttempted, repairVerify), `before.png` and `after.png`. Every text file goes through `maskSecrets` before it is written. The default out dir is `.scratch/agent-runs/<timestamp>`, which is git-ignored.
  - **Screenshots:** the in-sandbox checker with a screenshot path, read back as bytes (`Project.readBytes`). It retries 3 times, 3 s apart, while the dev server starts.
  - **Rate limits:** a run whose turn ends with the 429 message is retried on a fresh sandbox after `backoffMs × 2^(attempt-1)` (5 s, then 10 s), up to `maxAttempts` (3). The AI SDK's own per-call retries still apply first.
  - **Eval key:** `evalCredential(env)` reads only `OPENAI_EVAL_API_KEY` (never `OPENAI_API_KEY` or a user credential) and refuses to start without it. The runner is a separate process from the app. Because OpenAI rate limits are per project, not per key, the eval key must belong to its own OpenAI project; `.env.example` says so.
  - **Traces:** each run produces the normal turn trace; `flushTraces()` runs before exit.
  Evidence:
  - `bun run typecheck` + `bun run test` run 1: pass, run 2: pass (57 tests). `runner.test.ts` uses a task list built inside the test, mock models and temp git projects:
    - **Parsing:** extra fields kept; empty array, non-array, `../x` id, missing prompt and duplicate id all rejected.
    - **Eval key:** `evalCredential` takes only `OPENAI_EVAL_API_KEY` and throws when only `OPENAI_API_KEY` is set.
    - **2 tasks × 2 runs, cap 2:** 4 results all `passed`, 4 model instances, at most 2 runs in flight. Each folder holds exactly `after.png, before.png, diff.patch, task.json, turn.json, verify.json`. `turn.json` carries `SYSTEM_PROMPT_HASH`, the task prompt and a 40-hex checkpoint; `diff.patch` holds the edit; `verify.json` shows `ok: true`; `task.json` equals the input including its extra field.
    - **Cap of 1:** 3 runs complete in order with never more than one in flight.
    - **429 on the first attempt:** one 5 s backoff, a second sandbox, then `passed` with `attempts: 2`; logs `only run 1: rate limited, retrying in 5s` and `only run 1: passed`.
    - **Screenshot:** the checker is called with `/tmp/betterlook/preview.png`, retried twice with 3 s waits, and the bytes come back.
  - **Real CLI path (Bun bundle, then Node):**
    - no env: `Error: Set the Vercel sandbox credentials in apps/web/.env.`
    - fake Vercel vars only: `Error: Set OPENAI_EVAL_API_KEY in apps/web/.env. The runner never uses a user key.`
    - fake Vercel vars plus a fake eval key: `@vercel/sandbox` loads under Node and the real API answers `Status code 403 is not ok: Not authorized`.
    - The fake values appear 0 times in the output. A relative `--tasks` path resolves from the repo root.
  - LIVE PROOF PENDING ENV: founder task file + OPENAI_EVAL_API_KEY + Vercel. Run `bun run agent:run --tasks <founder file> --runs 2` and confirm that each task has `run-1` and `run-2` folders, each holding `task.json`, `turn.json`, `diff.patch`, `verify.json`, `before.png` and `after.png`. The PNGs should show the preview before and after the edit, and each run's trace should appear in Langfuse.
- [ ] End to end: "make the hero heading blue" from the landing screen edits the code, verify passes, the preview turns blue, and the trace has every tool call, the diff and the checkpoint id.

  Not done, left unticked on the orchestrator's instruction: it needs the founder's `.env` (OpenAI key, Vercel credentials, Langfuse keys) and AI-UI's chat wired through `createAgentChat`. Every piece it exercises is built and tested at the mock level (items 2–8). LIVE PROOF PENDING ENV: from `/`, send "make the hero heading blue". The agent reads and edits `src/App.tsx` in the sandbox, verify passes (typecheck, build and runtime all passed), and the preview shows a blue heading. The Langfuse trace for the turn holds every tool call, the diff and `checkpointId`. Capture screenshots and the trace id.
- [x] Failure states: rate limit, provider error, sandbox down, denied tool, failed verify and step limit each show a readable message, and the chat keeps working.

  Built: every turn now ends with a `finish` chunk carrying assistant message metadata `{status, notice?}`. `notice` is the readable sentence for the outcome (`noticeFor(record)` in `run.ts`). The model stream is piped in order, so the `finish` always comes last, after any error chunk. The six cases:
  - **Rate limit (429):** error chunk and notice "The model provider is rate limiting requests. Wait a minute and try again." The SDK unwraps its retry wrapper to find the 429. The runner retries these runs with backoff.
  - **Provider error:** "The model provider returned an error. Try again." Provider text is never forwarded.
  - **Sandbox down:**
    - before the turn: `/api/chat` returns 503 "The preview sandbox is not reachable. Reload to try again.";
    - mid-turn (git or command failure): error chunk and notice "The preview sandbox stopped responding. Reload to try again.";
    - on load: `/api/sandbox` returns the 503 or 502 messages from the sandbox item.
  - **Denied tool:** the `data-denied` part carries `message` (for example "/etc/passwd is outside the project folder."), the model gets the reason, and the turn carries on.
  - **Failed verify:** status `failed`, notice "The change still fails its checks after one repair attempt. Restore the previous version or describe what to fix." The `data-checkpoint` part carries `parentId` for the restore.
  - **Step limit:** `TurnRecord.stepLimitReached`, set when the run used all `maxSteps` and the last step still called tools; notice "The agent hit its step limit before finishing. Send another message to let it continue."
  Evidence:
  - `bun run typecheck` + `bun run test` run 1: pass, run 2: pass (64 tests). `failure.test.ts` runs one test per case. Each checks the readable message (error chunk and/or `metadata.notice`), that `finish` is the last chunk, that provider text such as "provider says no" never leaks, and then runs a normal turn afterwards ("Still here.", status `passed`) to show the chat keeps working.
    - Sandbox down before the turn goes through the real `/api/chat` route and gets the 503 text.
    - The step-limit test sees exactly `maxSteps` (20) model calls and `stepLimitReached: true`.
  - UI: the real `runAgent` streams for rate limit, provider error and sandbox down mid-turn, built with the mock model, were served to the current workspace in sequence, followed by a normal reply:
    - `.screenshots/failure-rate-limit-1440.png` ("The model provider is rate limiting requests. Wait a minute and try again.")
    - `.screenshots/failure-provider-1440.png`
    - `.screenshots/failure-sandbox-down-1440.png` ("The preview sandbox stopped responding. Reload to try again.")
    - `.screenshots/failure-chat-keeps-working-1440.png` (the next message got "Still here, the chat works.")
    The notices for denied, failed verify and step limit live in data parts and metadata. The current minimal workspace only renders `error.message`, so showing them is AI-UI's wiring, against the contract above.
  - Live route after the change: `[agent] model call failed: 401`, `POST /api/chat 200`, then `401`.
  - Secret grep over logs, `apps/web/src` and `apps/web/scripts`: the only hit is the fake masking fixture in `trace.test.ts`. No `.env`.
  - LIVE PROOF PENDING ENV: with a real key and sandbox, trigger each case in the wired UI (a revoked or low-limit key for 429, a stopped sandbox, `/etc/passwd`, a deliberately broken edit, a long task) and confirm the notice shows and the next message works.

## types.ts changes

- v1 (Plan item): `ProviderCredential` (`api-key` | `oauth` with `accessToken`), `ProviderId`, `ToolName`, `DeniedCall`, `ToolCallRecord`, `VerifyCheck`, `VerifyResult`, `Checkpoint`, `Usage`, `TurnStatus`, `TurnRecord`, `TurnEvent` (restore, keep, approve, deny). AUTH: an OAuth token goes in `{kind: 'oauth', accessToken}`; `ProviderId` widens when a second provider lands.
- Dependency (orchestrator request, 2026-11-18): `ai@7.0.176` (exact) added to `apps/web/package.json`. This is **v7**, not v5: npm `latest` is 7.0.176, and v5 (5.0.291) and v6 are maintenance tags. `import type {UIMessage, ToolUIPart} from 'ai'` typechecks. The founder's brief named v5; the APIs it names (`streamText`, tools, `stopWhen` + `stepCountIs`, `useChat`) carry through v7, and `useChat` comes from `@ai-sdk/react`, which lands with the Agent core item. No provider package or sandbox SDK added. Evidence: `bun run typecheck` run 1: pass, run 2: pass.

- `0dccdb9a` (orchestrator priority, for AUTH): `ProviderId = 'openai' | 'anthropic'`. OpenAI is the first provider; `anthropic` is reserved for the second.

- Allowed models (orchestrator correction): `apps/web/src/lib/agent/models.ts` exports `MODELS: {id, label, provider}[]` as plain data, safe to import on the client (type-only import of `ProviderId`). OpenAI default first: `gpt-5.5`, then `gpt-5` (both are ids `@ai-sdk/openai@4.0.121` knows; founder can edit the list). `/api/chat` rejects any model not in it (`providerOf` looks it up). AI-UI's picker imports it; `composer/` is untouched.

- Tracing item: `TurnRecord.provider` is now `string`, the AI SDK provider id such as `openai.responses`, instead of `ProviderId`. `runAgent()` returns `{result, turn}`, where `turn` is a `Promise<TurnRecord>`.

- `7449b371` orchestrator request (for AI-UI): `VerifyCheck.ok: boolean` is replaced by `status: VerifyCheckStatus` (`'passed' | 'failed' | 'skipped'`), so a runtime check skipped because the build failed no longer reads as a failure. `VerifyResult.ok` stays the overall pass.

- Data contract (orchestrator): `types.ts` now imports `type UIMessage` from `ai` and exports:
  - `AgentDataParts`, the custom data parts the chat stream writes: `denied: DeniedCall`, `approval: PendingApproval` (`toolCallId`, `tool`, `path`, `diff`, the proposed unified diff), `verify: VerifyResult`, `checkpoint: Checkpoint`, `diff: TurnDiff` (`diff`, `filesTouched`). They reach the UI as `data-denied`, `data-approval`, `data-verify`, `data-checkpoint` and `data-diff` parts.
  - `AgentMetadata` (`model?`, `turnId?`, `traceId?`).
  - `AgentMessage = UIMessage<AgentMetadata, AgentDataParts>`.
  `DeniedCall` gains `toolCallId`. A policy-denied call still goes back to the model as a tool error; the stream also writes a `data-denied` part.
- Ownership (orchestrator): `workspace/Workspace.tsx` belongs to AI-UI from now on. AI-CORE's last change to it is `12b85c12`; nothing is uncommitted.

- Tools item, new server exports from `lib/agent/` (no `types.ts` type changes beyond `7251b7ef`):
  - `run.ts`: `runAgent({model, messages, project?, abortSignal?, onData?})`, `agentUIStream(...)` (the stream `/api/chat` serves, with `data-*` parts), `AgentChunk`, `TOOL_CONFIG_HASH`.
  - `policy.ts`: `checkPolicy(tool, input, root)`.
  - `tools.ts`: `TOOL_DEFINITIONS`, `createTools`, `applyEdit`, `proposedDiff`.
- Tools item, for AI-UI: `lib/agent/client.ts` exports `createAgentChat({getCredential, getSandboxId, messages?})`, which returns `Chat<AgentMessage>`. Pass it as `useChat({chat})`, send with `sendMessage({text, metadata: {model}}, {body: {model}})`, and answer approvals with `chat.addToolApprovalResponse({id: part.approval.id, approved, reason?})`; the chat continues by itself. `/api/chat` now reads `sandboxId` from the body, so the workspace must send it (`createAgentChat` does). Until then the agent has no tools in the live UI.

- Checkpoint item, types: `Checkpoint.parentId` (the commit before the turn, so "undo this turn" is a restore to `parentId`), and every `TurnEvent` gets an optional `traceId`, so events land in the turn's Langfuse trace.

- AUTH fold-in (orchestrator): merged `betterlook` (18533f49, merge `25db853e`). `/api/chat` imports the real `getServerCredential` from `@/lib/auth/server` (stub deleted). `parseCredential` accepts only `{provider: 'openai', kind: 'api-key', apiKey}` from the request body; an `oauth` credential in the body is rejected with the missing-key 401, so OAuth only comes from the session cookie. Tested in `app/api/chat/route.test.ts`.

- **Checkpoint item, for AI-UI (all on `ai-core`):**
  1. **Stream.** At turn end, the stream writes `data-checkpoint` (id `checkpoint`, a `Checkpoint` with `id` and `parentId`), `data-diff` (id `diff`, a `TurnDiff`) and `data-verify` (id `verify`, a `VerifyResult`). After the single repair it writes `data-checkpoint` and `data-diff` again (same ids, so they replace) and a second `data-verify` with id `repair-verify`. A turn paused for approval writes none of them. The assistant message metadata is `{turnId, traceId}`. `TurnRecord.status` ends as `passed`, `failed`, `awaiting-approval`, `stopped` or `error`.
  2. **`VerifyCheck.status`** is `'passed' | 'failed' | 'skipped'` (`7449b371`). Runtime is `skipped` when the build failed or the checker could not run. Show skipped as neutral; `VerifyResult.ok` is the overall pass.
  3. **Restore and keep**, from `lib/agent/client.ts`:
     - `restoreCheckpoint({sandboxId, checkpointId, turnId, traceId?})` → `POST /api/restore` → `{headId}`. To undo a turn, pass `checkpoint.parentId`; to return to a turn's result, pass `checkpoint.id`. The server logs the `restore` TurnEvent. On failure it throws an Error whose message is the route's readable text.
     - `keepTurn({turnId, traceId?})` → `POST /api/events` → logs the `keep` TurnEvent.
     - Approve and deny need no client call: the server logs them when the approval response arrives with the next request (`chat.addToolApprovalResponse`).
  - Server exports: `runAgent(...)` now returns `{stream, turn}` (`agentUIStream` removed); `SYSTEM_PROMPT_HASH` (prompt plus repair prompt); `repairMessage`; `checkpoint.ts` (`commitTurn`, `restoreCheckpoint`); `verify.ts` (`verifyProject`, `runtimeErrors`); `events.ts` (`logEvent`, `parseKeepEvent`).

- Runner item, new exports: `lib/agent/runner.ts` (`parseTasks`, `evalCredential`, `runTasks`, `previewScreenshot`, `Task`, `RunSummary`), `RUNNER_CONFIG` in `config.ts`, `Project.readBytes`, and `RATE_LIMITED` in `errors.ts` (a 429 now gets its own message: "The model provider is rate limiting requests. Wait a minute and try again.").

- Failure-states item, types: `AgentMetadata` gains `status?: TurnStatus` and `notice?: string`. Every turn now ends by writing assistant message metadata `{status, notice?}`, and `notice` is the readable sentence to show for that outcome. `TurnRecord` gains `stepLimitReached: boolean`.

- Failure-states item, for AI-UI: render `message.metadata.notice` when it is set (the turn status is in `metadata.status`), and `data-denied` `data.message` for a policy denial. New exports in `errors.ts`: `RATE_LIMITED`, `VERIFY_FAILED`, `STEP_LIMIT`; `noticeFor(record)` in `run.ts`.

## Questions for the founder

Answered 2026-11-18 (see Plan). Open:

- **Headless runner (built per the orchestrator; still needs the founder for the live run):** please give the two-task sample file for `agent:run`, and confirm its format. My default is JSON: `[{"id": "hero-blue", "prompt": "..."}]`, with any extra fields the founder's judges need passed through untouched into each run folder. I won't write task content. The live runner will also need `OPENAI_EVAL_API_KEY` (a key separate from users', so it doesn't share their rate-limit budget) plus the Vercel credentials in `apps/web/.env`.
- **Runner runtime note:** `@vercel/sandbox` does not load under Bun, so `bun run agent:run` will run the script under Node (`bun run` → `node --experimental-strip-types`), or through a small Node bundle if Node's type stripping cannot resolve the extensionless imports. I'll pick at build time.

- Resolved: the picker default moves to AI-UI importing `lib/agent/models.ts` (see types.ts changes). Until AI-UI wires it, `Workspace.tsx` still seeds from `composer/models.ts`, so a non-OpenAI pick shows "<model> is not connected yet."

Original questions:

1. **Sandbox:** Vercel Sandbox (my pick), E2B or Daytona? I need a Vercel team token (or OIDC via `vercel link`) in `.env` as `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`. I won't create the account.
2. **First provider:** Anthropic via `@ai-sdk/anthropic` (my pick: explicit prompt caching through `cacheControl`, and the picker already defaults to Claude), or OpenAI via `@ai-sdk/openai` (fits a ChatGPT-subscription credential if AUTH lands one)? Either way the second provider is one entry in a provider map.
3. **Where the user's key lives:** I'll use your default unless you say otherwise: in the browser (localStorage), sent per request in a header, used for that call only, never stored, logged or traced server-side.
4. **Eval key and Langfuse:** for later items I need, in `.env` (never shown to me in chat): `ANTHROPIC_EVAL_API_KEY` (or the OpenAI equivalent), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
5. **System prompt slot:** this will be `apps/web/src/lib/agent/system-prompt.ts`, a one-line placeholder for you to fill in. It lands with the Agent core item.

## Pending e2e

Live checks that need the founder's `.env` (OpenAI eval key, Vercel token, Langfuse keys).

- End to end: "make the hero heading blue" from the landing page, verify passes, the preview turns blue, and the trace has every tool call, the diff and the checkpoint id (screenshots plus trace id).
- Failure states: each case shows its notice in the wired UI, and the chat keeps working.
- Headless runner: founder task file + OPENAI_EVAL_API_KEY + Vercel. `agent:run --runs 2` writes complete folders with real before and after screenshots, and each run has its trace.
- Checkpoint and verify: in a real sandbox, the checker installs, the runtime check runs in the sandbox, a turn streams checkpoint, diff and verify, a broken edit gets one repair, and restore reverts the preview and logs the event.
- Tools and policy: in a real sandbox, read and edit run; `/etc/passwd` is denied and shown; a `package.json` edit pauses, Approve writes and Deny leaves it.
- Sandbox: real Vercel sandbox from the landing prompt, the preview shows the starter, a reload reconnects to the same sandbox, and a stopped sandbox resumes with the dev server restarted.
- Tracing: a Langfuse trace per turn with nested model spans, hashes in metadata, record as output, cost computed; hash changes after a prompt edit; exported trace JSON has no `.env` value.
- BYOK: valid key streams; missing key and revoked key show the two messages (needs AUTH's `getCredential()` and a real key).
- Agent core: streamed reply from a real OpenAI model at `/workspace?model=gpt-5`; Stop aborts the server request.

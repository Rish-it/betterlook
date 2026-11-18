# AI-CORE progress

Worker: AI-CORE (the AI layer). Branch: `ai-core`. Dev server port 3400.

## Checklist

- [ ] Plan: use the agent-reach skill to compare E2B, Vercel Sandbox and Daytona (isolation, preview URL, file API, git support, startup time, cost). Write the comparison, your pick, the runAgent() flow in 5-10 lines, and a draft of lib/agent/types.ts (committed as the real file). Ask the founder: which sandbox, which first provider, and where the user's key lives (default: in the browser, sent per request, used for that call only, never stored server-side). Stop and wait.

  Research done, waiting on founder answers (see Questions). Sources: e2b.dev/pricing, docs.e2b.dev/billing, github.com/e2b-dev/infra ARCHITECTURE.md, vercel.com/docs/sandbox/pricing, vercel.com/docs/sandbox (concepts + working-with-sandbox + SDK reference), daytona.com/pricing, daytona.com/docs/preview, daytona.com/docs/file-system-operations. Gathered with agent-reach (Exa search), 2026-11-18.

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
  2. Build the model from `credential` (`@ai-sdk/anthropic`, per-request `createAnthropic({apiKey | authToken})`), hash the system prompt and tool config.
  3. `streamText({model, system, messages, tools, stopWhen: stepCountIs(config.maxSteps), maxOutputTokens, providerOptions: cache control, experimental_telemetry})`.
  4. Each tool's `execute` first calls `checkPolicy(tool, args)`: deny returns a tool error to the model and records a `DeniedCall`; a protected path emits `awaiting-approval` and waits for approve/deny.
  5. On finish: `git commit` in the sandbox, giving the `Checkpoint`; run verify (tsc, build, preview console/page errors).
  6. If verify fails: one repair `streamText` with the errors, commit again, verify again; still failing means status `failed`, restore offered.
  7. Assemble the `TurnRecord` (diff, files touched, usage, cost, hashes), mask secrets, send to Langfuse via the AI SDK OpenTelemetry export, return it.

  **types.ts draft:** committed as `apps/web/src/lib/agent/types.ts` (the real file).

- [ ] Agent core, text only: lib/agent/types.ts committed; runAgent() streams replies into the chat panel; model picker, stop button and step limit work.
- [ ] BYOK: the key flows the way the founder picked; missing or wrong key shows a clear message.
- [ ] Turn record and tracing: each turn lands in Langfuse with the required fields; prompt and tool config hashes change on edit; no secret appears in an exported trace.
- [ ] Sandbox and preview: a fresh sandbox from a minimal React starter, initialized as a git repo; the preview shows it; reload reconnects to the same sandbox.
- [ ] Tools and policy: the allowlisted tools work; a call outside the project folder is denied, logged and returned to the model as a tool error; a package.json edit pauses for approval.
- [ ] Checkpoint and verify: commit per turn, verify after each turn, one repair attempt, failed-turn state, restore works, events logged.
- [ ] Headless runner: agent:run on a two-task sample file from the founder produces complete run folders, 2 runs each, through the same runAgent().
- [ ] End to end: "make the hero heading blue" from the landing screen edits the code, verify passes, the preview turns blue, and the trace has every tool call, the diff and the checkpoint id.
- [ ] Failure states: rate limit, provider error, sandbox down, denied tool, failed verify and step limit each show a readable message, and the chat keeps working.

## types.ts changes

- v1 (Plan item): `ProviderCredential` (`api-key` | `oauth` with `accessToken`), `ProviderId`, `ToolName`, `DeniedCall`, `ToolCallRecord`, `VerifyCheck`, `VerifyResult`, `Checkpoint`, `Usage`, `TurnStatus`, `TurnRecord`, `TurnEvent` (restore, keep, approve, deny). AUTH: an OAuth token goes in `{kind: 'oauth', accessToken}`; `ProviderId` widens when a second provider lands.

## Questions for the founder

1. **Sandbox:** Vercel Sandbox (my pick), E2B or Daytona? I need a Vercel team token (or OIDC via `vercel link`) in `.env` as `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`. I won't create the account.
2. **First provider:** Anthropic via `@ai-sdk/anthropic` (my pick: explicit prompt caching through `cacheControl`, and the picker already defaults to Claude), or OpenAI via `@ai-sdk/openai` (fits a ChatGPT-subscription credential if AUTH lands one)? Either way the second provider is one entry in a provider map.
3. **Where the user's key lives:** I'll use your default unless you say otherwise: in the browser (localStorage), sent per request in a header, used for that call only, never stored, logged or traced server-side.
4. **Eval key and Langfuse:** for later items I need, in `.env` (never shown to me in chat): `ANTHROPIC_EVAL_API_KEY` (or the OpenAI equivalent), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
5. **System prompt slot:** this will be `apps/web/src/lib/agent/system-prompt.ts`, a one-line placeholder for you to fill in. It lands with the Agent core item.

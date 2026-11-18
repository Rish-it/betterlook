# AI-UI progress

Worker AI-UI: agent UI components in `apps/web/src/components/ai/**`, `apps/web/src/composer/**` and `apps/web/src/app/dev/ai/page.tsx`. Dev server port 3500.

- [x] Map: use the agent-reach skill to read the relevant AI Elements and Beautiful UI pages. For each component, write one line: the reference you'll follow, the Astryx components it's built from, and its props (using our shared types). Flag Astryx gaps. Stop and wait for my OK.

  Founder OK received through the orchestrator. Read through agent-reach (web channel, Jina Reader) on 2026-11-18: AI Elements `conversation`, `message`, `prompt-input`, `tool`, `confirmation`, `reasoning`, `checkpoint`, `shimmer`, `web-preview`, plus the Beautiful UI index (Thinking, Approval Card, Tool Chips, Diff Table). I port no code from either, so no licence notices are needed; every component is our own, built on Astryx 0.7.16.

  Shared types come from `lib/agent/types.ts` v1 (merged from `betterlook` at e7c6d5ec). Imported, never declared. `UIMessage`/`ToolUIPart` come from `ai`, which AI-CORE is adding.

  | Component | Reference | Astryx parts | Props |
  |---|---|---|---|
  | Conversation | AE `Conversation` (stick-to-bottom, scroll button) | `ChatLayout` (built-in auto-scroll), `ChatMessageList` (has `aria-live` and `aria-busy` while streaming), `ChatLayoutScrollButton`, `EmptyState` | `{messages: UIMessage[]; isStreaming: boolean; composer: ReactNode; renderTurnExtras?(messageId): ReactNode}` |
  | Message | AE `Message` + `Reasoning` (parts in order, reasoning collapsible) | `ChatMessage`, `ChatMessageBubble`, `Markdown`, `Collapsible` (reasoning) | `{message: UIMessage; isStreaming: boolean}`; maps `text`, `reasoning`, `tool-*` parts in order |
  | Prompt input | AE `PromptInput` (attachments, model select, submit/stop) | existing `composer/Composer.tsx` on `ChatComposer`, `ChatComposerDrawer` (attachments), `ChatSendButton` (send/stop), `FileInput`, existing `ModelPicker` (`Selector`) | existing props + `{isStreaming: boolean; onStop(): void; attachments: File[]; onAttachmentsChange(files: File[]): void}` |
  | Tool call row | AE `Tool` (ToolUIPart states), BUI Tool Chips (compact) | `ChatToolCalls` (statuses `pending/running/complete/error`, `target`, `errorMessage`, `resultDetail`), `CodeBlock` (JSON args and result) | `{part: ToolUIPart}`; maps `input-streaming` to pending, `input-available` to running, `output-available` to complete, `output-error` to error |
  | Denied call | AE `Confirmation` `output-denied` state | `ChatToolCalls` row + `Token` "Blocked by policy" + `InfoTip` for the reason | `{call: DeniedCall}` (label from `reason`: `outside-project`, `not-allowlisted`, `user-denied`) |
  | Approval card | AE `Confirmation`, BUI Approval Card | `Card` (tone background, no border), `CodeBlock` language `diff`, `ButtonGroup` with two `Button`s | `{turnId: string; call: ToolCallRecord; onEvent(event: TurnEvent): void}`; emits `approve`/`deny`; shown while `TurnRecord.status === 'awaiting-approval'` |
  | Verify result | none in AE; BUI Tool Chips pattern | `Collapsible`, `StatusDot` per check, `CodeBlock` for output | `{result: VerifyResult}`; one row per `VerifyCheck` (`typecheck`, `build`, `runtime`), expands to `errors` |
  | Diff view | BUI Diff Table | `Collapsible` (closed by default), `List`, `CodeBlock` language `diff` | `{diff: TurnRecord['diff']; files: TurnRecord['filesTouched']}`; line counts parsed from the unified diff |
  | Checkpoint | AE `Checkpoint` | `ChatSystemMessage`, `Button`, `AlertDialog` (confirm step) | `{checkpoint: Checkpoint; onEvent(event: TurnEvent): void}`; emits `restore` after confirm |
  | Thinking state | AE `Shimmer`, BUI Thinking | `Text` + StyleX keyframes on token colours, fixed line height so nothing jumps | `{label?: string}` |
  | Preview toolbar | AE `WebPreview` (nav bar) | `Toolbar`, `IconButton` (refresh, open in new tab), `StatusDot` | `{url: string; status: 'loading' \| 'ready' \| 'error'; onRefresh(): void}` |

  Astryx gaps:
  - `ChatToolCalls` has no "denied" status, so the denied call is our own row next to it, styled so it can't be mistaken for an error.
  - There is no text shimmer primitive (`Skeleton` is a block), so the thinking shimmer is our own StyleX keyframe on token colours.
  - `ChatSystemMessage`'s `divider` variant draws lines, which breaks the borderless rule, so the checkpoint uses its `default` variant.
  - `ChatToolCalls`'s `additions`/`deletions` cover the diff stats; `CodeBlock` supports `diff`, so no new dependency is needed.

  Needs from AI-CORE: the `ai` dependency (in progress).

  Notes on types.ts v1:
  - `ToolCallRecord.decision` has no pending value. The approval card shows the call while the turn is `awaiting-approval`; tell me if a different field will mark the pending call.
  - `TurnRecord.diff` is one unified diff string, so the diff view parses per-file line counts from it.
- [x] Fixtures and a dev-only page that renders every component in every state.

  - `apps/web/src/components/ai/fixtures.ts`: one fixtures file, typed only with imported `ai` v7.0.176 types (`UIMessage`, `ToolUIPart`) and `lib/agent/types.ts` types. Nothing shared is redeclared. Model id `gpt-5` (OpenAI is the first provider). It covers:
    - two conversations: one done, with reasoning, three completed tool calls and the reply; one still streaming, with streaming reasoning, a failed edit, a tool call whose input is streaming, and streaming text
    - tool parts in `input-streaming`, `input-available`, `output-available` and `output-error`
    - `DeniedCall` for each reason: `outside-project`, `not-allowlisted`, `user-denied`
    - a pending `package.json` approval as a `ToolCallRecord`
    - `VerifyResult` passed, plus typecheck, build and runtime failures
    - a two-file `TurnRecord['diff']` with `filesTouched`, a `Checkpoint`, and preview `loading`, `ready` and `error`
  - `apps/web/src/app/dev/ai/page.tsx`: `/dev/ai`, one section per component, one labelled block per state. It calls `notFound()` in production. Each state shows its raw fixture for now; items 3 to 9 swap in the real component. Code blocks have their borders removed, as the borderless rule requires.
  - `bun run typecheck`: exit 0 on two clean runs (tsbuildinfo removed before the second). `npx react-doctor@latest`: 100/100. No console errors; scrollWidth 1280 at 1280px.
  - Screenshots, checked by eye: `.screenshots/ai-02-fixtures-light.png` and `.screenshots/ai-02-fixtures-dark.png` (full page, every state visible, no borders).
  - `ProviderId` now includes `'openai'` (merged from `betterlook` at 0dccdb9a).
- [x] Conversation and Message, with streaming text and reasoning.

  - `components/ai/Conversation.tsx`: `{messages: UIMessage[]; isStreaming: boolean; composer: ReactNode}` on `ChatLayout` and `ChatMessageList`. Astryx handles stick-to-bottom and the scroll-to-latest button; `isStreaming` sets `aria-busy` on the `role="log"` list, so a screen reader announces a finished reply once rather than every token. Checked in the DOM: `aria-busy="true"` while streaming, removed once done.
  - `components/ai/Message.tsx`: `{message: UIMessage}`. A user message is a filled bubble. An assistant message renders its parts in order:
    - text uses `Markdown`, with `isStreaming` from `part.state`, which fades in the newest word
    - reasoning is a `Collapsible`: "Thinking", open while streaming; "Thought", collapsed once done; `aria-expanded` is on the trigger
    - tool parts render through `ToolCall`
    - the model label comes from `metadata.model` (shows "GPT-5")
  - `components/ai/ToolCall.tsx`: minimal for now. It maps every `ai` v7 tool state to an `ChatToolCalls` status, with the error text on `output-error`. Item 5 adds the argument summary, expand-to-detail and the denied call.
  - Dev page: a live `Conversation` replays a streaming reply every few seconds, and each fixture message also renders on its own.
  - Screenshots, checked by eye:
    - `.screenshots/ai-03-conversation-{light,dark}.png`: mid-stream, stuck to the bottom
    - `.screenshots/ai-03-scrolled-up-{light,dark}.png`: scrolled to the top, scroll-to-latest button showing
    - `.screenshots/ai-03-messages-{light,dark}.png`: full page with every message state (done and streaming reasoning, done/running/error/pending tools, done and streaming text)
    - all borderless; no console errors; no horizontal scroll at 1280px
  - `bun run typecheck`: exit 0 on two clean runs.
  - `react-doctor`: I fixed the non-component export in `ToolCall.tsx`. Two `no-array-index-as-key` warnings remain in `Message.tsx`. I judged them false positives: `TextUIPart` has no id and a message's parts are append-only, so the index is their stable identity. Reasoning uses `part.id` when it has one. A one-line comment in the code records why.
- [x] Prompt input upgrade.

  - Orchestrator: the model list moves to AI-CORE's `lib/agent/models.ts` (plain data, OpenAI default first). When that is on `betterlook`, point `ModelPicker` at it and delete `composer/models.ts`. Until then, keep the current list.
  - `composer/Composer.tsx`: `onSubmit(text, model, attachments: File[])`, plus `isStreaming?` and `onStop?`.
    - Attach opens a hidden native `<input type="file" multiple>`; picked files show as removable `Token`s in a `ChatComposerDrawer` above the input, with duplicates ignored.
    - Submitting passes the files and clears them.
    - While streaming, the composer is `isDisabled`: input not editable, `aria-disabled="true"`, attach and model disabled. Its Stop button stays enabled and calls `onStop`.
    - Callers on `/` and `/workspace` are unchanged (the extra argument is ignored).
  - `composer/ModelPicker.tsx`: takes `isDisabled`. The model list stays in `composer/models.ts` until `lib/agent/models.ts` lands.
  - Checked in the browser:
    - 2 files attached, then 1 removed, leaves 1 token
    - Enter submits and clears both the tokens and the text
    - streaming composer: `contenteditable=false`, `aria-disabled=true`, Stop enabled
    - landing composer still renders; no console errors
  - Screenshots, checked by eye: `.screenshots/ai-04-composer-light.png` and `.screenshots/ai-04-composer-dark.png`, showing idle with two attachments and typed text, and streaming (dimmed, Stop shown). Borderless.
  - `bun run typecheck`: exit 0 on two clean runs. `react-doctor`: only the two index-key warnings in `Message.tsx` already judged false positives in item 3.
- [ ] Tool call row and denied call.
- [ ] Approval card.
- [ ] Verify result and diff view.
- [ ] Checkpoint with restore confirm.
- [ ] Thinking state and preview toolbar.
- [ ] Wire-up: only once the AI loop has that data, swap mocks for live data in the chat panel and connect approve/deny/restore callbacks; list anything still on mocks.

## Questions for the founder

1. Map above: OK to proceed?
2. For AI-CORE, through the orchestrator: the `ai` dependency (for `UIMessage` and `ToolUIPart`). types.ts v1 is merged.

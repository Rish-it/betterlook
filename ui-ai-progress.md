# AI-UI progress

Worker AI-UI: agent UI components in `apps/web/src/components/ai/**`, `apps/web/src/composer/**` and `apps/web/src/app/dev/ai/page.tsx`. Dev server port 3500.

- [ ] Map: use the agent-reach skill to read the relevant AI Elements and Beautiful UI pages. For each component, write one line: the reference you'll follow, the Astryx components it's built from, and its props (using our shared types). Flag Astryx gaps. Stop and wait for my OK.

  Map drafted, waiting for the founder's OK. Read through agent-reach (web channel, Jina Reader) on 2026-11-18: AI Elements `conversation`, `message`, `prompt-input`, `tool`, `confirmation`, `reasoning`, `checkpoint`, `shimmer`, `web-preview`, plus the Beautiful UI index (Thinking, Approval Card, Tool Chips, Diff Table). I port no code from either, so no licence notices are needed; every component is our own, built on Astryx 0.7.16.

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
- [ ] Fixtures and a dev-only page that renders every component in every state.
- [ ] Conversation and Message, with streaming text and reasoning.
- [ ] Prompt input upgrade.
- [ ] Tool call row and denied call.
- [ ] Approval card.
- [ ] Verify result and diff view.
- [ ] Checkpoint with restore confirm.
- [ ] Thinking state and preview toolbar.
- [ ] Wire-up: only once the AI loop has that data, swap mocks for live data in the chat panel and connect approve/deny/restore callbacks; list anything still on mocks.

## Questions for the founder

1. Map above: OK to proceed?
2. For AI-CORE, through the orchestrator: the `ai` dependency (for `UIMessage` and `ToolUIPart`). types.ts v1 is merged.

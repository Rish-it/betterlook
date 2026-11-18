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

  - Model list move done after the orchestrator gave AI-UI `workspace/Workspace.tsx`. Merged `betterlook` 7058fc73 and kept AI-CORE's sandbox and localStorage logic.
    - `ModelPicker`, `Composer`, `Message` and `Workspace` all import `MODELS` from `@/lib/agent/models` and match on `m.id`. `composer/models.ts` is deleted.
    - `Workspace` passes `isStreaming={isBusy}` and `onStop={stop}` to `Composer` and no longer has its own Stop button.
  - Live check on `/workspace?prompt=Make+the+nav+sticky&model=gpt-5`, with Playwright stubbing `/api/chat` (a delayed UI message stream) and `/api/sandbox`, and no real key:
    - while the first send is in flight: input `contenteditable=false`, composer Stop shown, no other Stop button
    - Stop aborts it; the input is editable again
    - a second send streams "Mock reply…"; both requests carried `model: gpt-5`; no console errors
    - screenshots: `.screenshots/ai-04-live-{light,dark}-streaming.png` and `-done.png`
  - `react-doctor` also flags `Workspace.tsx:182` ("data fetching inside an effect"): AI-CORE's sandbox request, kept as the orchestrator asked.
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
- [x] Tool call row and denied call.

  - `components/ai/ToolCall.tsx`: `{part: ToolUIPart | DynamicToolUIPart}` on `ChatToolCalls`, one row per call.
    - Each row shows the tool name, a short summary of its arguments, and a status: `input-streaming` shows pending, `input-available` running, `output-available` done, `output-error` error.
    - Once the input is complete, a row expands to its arguments as JSON and its result. A result that is a single string, such as `read_file`'s `{content}`, shows as plain text; on error the row shows the error text instead.
  - `components/ai/DeniedCall.tsx`: `{call: DeniedCall}`, our own row, since Astryx has no denied status.
    - It shows a warning icon on the warning-muted tone (no border), the tool in monospace, what it targeted, an orange `Token` per reason ("Blocked: outside project", "Blocked: tool not allowed", "Denied by you"), and the policy message.
    - An error row is a plain row with a red error icon, so the two can't be confused. The dev page puts both side by side.
  - `components/ai/summarize.ts` and `summarize.test.ts`: the argument summary; it prefers path, command, query or pattern, else the first string, and truncates at 60 characters. `bun test`: 2 pass.
  - Checked in the browser: there are 3 expandable rows (input-streaming has no detail); clicking expanded two, giving `aria-expanded` `false,true,true`. The keyboard focus ring shows on the running row. No computed borders in the expanded detail. No console errors.
  - Screenshots, checked by eye: `.screenshots/ai-05-tools-light.png` and `.screenshots/ai-05-tools-dark.png`, showing all 4 tool states (done and error expanded), all 3 denial reasons, and an error row for contrast.
  - `bun run typecheck`: exit 0 on two clean runs. `react-doctor`: only the two index-key warnings already judged false positives in item 3.
  - Orchestrator review fix: Astryx's `CodeBlock` drew an outline and a line under its header. `components/ai/Code.tsx` now wraps `CodeBlock` with `container="section"` (no outline) and `hasLanguageLabel={false}` (no header, so no line), plus a muted tone through `xstyle`. The tool rows, the dev page and the coming approval card and diff view all use it. Checked: no `<pre>` in a code block, or anything inside one, draws a border, pseudo-elements included (16 `<pre>` on the page). Re-shot `.screenshots/ai-05-tools-{light,dark}.png`.
  - Astryx note: `ChatToolCalls` rows are `div role="button"` with key handling, not `<button>`. They are keyboard-usable and expose `aria-expanded`.
- [x] Approval card.

  - `components/ai/ApprovalCard.tsx`: `{turnId: string; call: ToolCallRecord; onEvent(event: TurnEvent): void}`.
    - The card shows a title naming the protected file ("Edit a protected file: package.json") and one line of explanation. It sits on an accent-muted tone with no border, and is `role="group"` labelled by its title.
    - The proposed change shows as a highlighted diff when `args.diff` is a string (`isDiff`, added and removed lines tinted); otherwise it shows the args as JSON. It uses the borderless `Code`.
    - Approve and Deny are real `Button`s. A click emits `TurnEvent` `{type: 'approve' | 'deny', turnId, toolCallId, at}` and swaps the buttons for a status line (`role="status"`): "Approved. The agent is continuing." or "Denied. The file was not changed."
    - `decision: 'approved'` renders the approved state directly.
  - Dev page shows three states (pending, denied after a click, approved) plus the events the callback received. Checked: clicking Deny emitted `{"type":"deny","turnId":"turn_02","toolCallId":"call_pkg_2",…}`, the group's label resolves to its title, the focus ring shows on Approve, and there are no console errors.
  - Screenshots, checked by eye: `.screenshots/ai-06-approval-light.png` and `.screenshots/ai-06-approval-dark.png`.
  - `bun run typecheck`: exit 0 on two clean runs; `bun test`: 2 pass. `react-doctor`: only the two index-key warnings already judged false positives in item 3.
  - Open (it affects wire-up): types.ts v1 has no pending value on `ToolCallRecord.decision`, so the card shows whichever call the turn is `awaiting-approval` on (see Questions).
- [x] Verify result and diff view.

  - `components/ai/VerifyResult.tsx`: `{result: VerifyResult}`.
    - Collapsed, it is one line on a muted tone: a success or error icon and "Checks passed" or "<names> failed" (e.g. "Build, Runtime failed").
    - Expanded, it shows one row per `VerifyCheck` (`typecheck`, `build`, `runtime`) with its icon and duration, and a failed check's `errors` in wrapped borderless `Code`.
  - `components/ai/DiffView.tsx`: `{diff: TurnRecord['diff']}`.
    - Collapsed by default: "2 files changed +3 −1" on a muted tone.
    - Expanded: one diff block per file, the file path as the block title and its +/− counts in the header, hunks only, with added and removed lines tinted.
    - I dropped the planned `files` prop. The counts and paths all come from the diff, and `filesTouched` would only add files with no diff body.
  - `VerifyCheck.status` (merged from `betterlook` 7058fc73): a skipped check shows a neutral info icon and the word "skipped" in place of a duration, and stays out of the summary. `buildFailed` now reads "Build failed", not "Build, Runtime failed". Fixtures use `status`. Re-shot `.screenshots/ai-07-verify-diff-{light,dark}.png`.
  - `components/ai/diff.ts` (`parseDiff`, `hunks`) and `diff.test.ts`: splits a unified diff per file, counts lines, keeps the hunks only, and uses the old path for a deleted file. `bun test`: 4 pass.
  - Orchestrator nit fixed (applies to the approval card too): highlighted +/− lines now run the full width of the block. The block is now `width="100%"`, and a diff gets a `title`, so Copy moves into the header rather than taking a column beside the code. Measured: highlighted rows end 0px from the right edge of their code block. The approval card's diff also drops the `---`/`+++` lines (its title already names the file).
  - Bug caught: Astryx `Collapsible` defaults to `defaultIsOpen: true`. Verify and diff now pass `false`, so a fresh load shows all six collapsed (`aria-expanded=false`). Clicking expands only the one clicked.
  - Screenshots, checked by eye:
    - `.screenshots/ai-07-verify-diff-light.png` and `.screenshots/ai-07-verify-diff-dark.png`: passed collapsed; typecheck, build and runtime failed expanded; diff collapsed and expanded
    - `.screenshots/ai-06-approval-{light,dark}.png`, re-shot
  - `bun run typecheck`: exit 0 on two clean runs. `react-doctor`: only the two index-key warnings already judged false positives in item 3.
- [x] Checkpoint with restore confirm.

  - `components/ai/Checkpoint.tsx`: `{checkpoint: Checkpoint; onEvent(event: TurnEvent): void}`.
    - The marker is a `ChatSystemMessage` (default variant, so no divider lines) reading "Checkpoint · <Timestamp>" with a ghost Restore `Button`.
    - Restore opens an Astryx `AlertDialog`, "Restore this checkpoint?", with Cancel and a destructive Restore. Confirming emits `TurnEvent` `{type: 'restore', turnId, checkpointId, at}`; Cancel emits nothing.
    - The dialog's `--shadow-high` drew a light ring in dark mode; it is dropped with `xstyle` (`boxShadow: 'none'`). Tone and the dimmed backdrop separate it now.
  - Checked in the browser:
    - the `alertdialog` opens; Cancel leaves the events empty and returns focus to Restore
    - confirming emits `{"type":"restore","turnId":"turn_01","checkpointId":"cp_8f3a2c1",…}`
    - no console errors
  - Screenshots, checked by eye: `.screenshots/ai-08-checkpoint-{light,dark}-marker.png`, `-confirm.png` (dialog open) and `-restored.png` (event emitted).
  - `bun run typecheck`: exit 0 on two clean runs; `bun test`: 4 pass. `react-doctor`: only the two index-key warnings already judged false positives in item 3.
- [x] Thinking state and preview toolbar.

  - `components/ai/Thinking.tsx`: `{label?: string}` (default "Thinking").
    - A StyleX keyframe sweeps a gradient between the `--color-text-secondary` and `--color-text-primary` tokens across the text (`background-clip: text`, 2s linear, infinite). It doesn't animate under `prefers-reduced-motion`.
    - It is built on Astryx `Text` (supporting, block), so its line box matches the text that replaces it. It sits in a `role="status"` wrapper.
  - `components/ai/PreviewToolbar.tsx`: `{url: string; status: 'loading' | 'ready' | 'error'; onRefresh(): void}` on Astryx `Toolbar`.
    - A `StatusDot` shows the status: neutral and pulsing while loading, success when ready, error on failure. Each dot carries a label ("Preview loading", "Preview ready", "Preview failed to load").
    - A ghost refresh `IconButton` calls `onRefresh`, and an open-in-new-tab `IconButton` links to `url` (`noopener noreferrer`).
    - It matches the toolbar already in `Workspace.tsx`, which this replaces at wire-up.
  - Checked in the browser:
    - the swap demo alternates "Thinking" and a reply line every 2s, and the line below stays at y=452 every time over 6 samples: no layout jump
    - the shimmer's computed `animation` is the keyframe, 2s
    - all 3 dot labels are present; no console errors
  - Two jumps found and fixed on the way: an inline element sat on the same line as the next one, and a body-line-height strut added 4px. Building on `Text` matches the metrics.
  - Screenshots, checked by eye: `.screenshots/ai-09-thinking-toolbar-light.png` and `.screenshots/ai-09-thinking-toolbar-dark.png` (thinking alone, the swap demo, and the toolbar loading, ready and error).
  - `bun run typecheck`: exit 0 on two clean runs; `bun test`: 4 pass. `react-doctor`: only the two index-key warnings already judged false positives in item 3.
- [ ] Wire-up: only once the AI loop has that data, swap mocks for live data in the chat panel and connect approve/deny/restore callbacks; list anything still on mocks.

## Questions for the founder

1. Map above: OK to proceed?
2. For AI-CORE, through the orchestrator: the `ai` dependency (for `UIMessage` and `ToolUIPart`). types.ts v1 is merged.
3. Answered (orchestrator): AI-UI owns `Workspace.tsx` and made changes (a) and (b); see item 4. Original question: model list move (merged `betterlook` 1aa4c1c3, clean, typecheck passes). Two things block it, and both touch `workspace/Workspace.tsx`, which is AI-CORE's file until my wire-up item:
   - `Workspace.tsx` imports `MODELS` from `@/composer/models` (lines 27, 119, 183) and reads `m.value`. `lib/agent/models.ts` uses `{id, label, provider}`. Deleting `composer/models.ts` breaks typecheck in `Workspace.tsx`. Pointing only `ModelPicker` at the new list leaves the workspace's initial-model check on the old Claude/Gemini ids, so the picker and the sent model disagree.
   - `Workspace.tsx` renders its own Stop `Button` and does not pass `isStreaming={isBusy}` / `onStop={stop}` to `Composer`. The composer's built-in stop and disabled state therefore can't be re-checked against the live workspace until those props are passed.
   Proposal: AI-CORE makes two small changes in `Workspace.tsx`, (a) import `MODELS` from `@/lib/agent/models` and use `m.id`, and (b) pass `isStreaming={isBusy} onStop={stop}` to `Composer` and drop its separate Stop button. I then switch `ModelPicker`, `Composer` and `Message` to `lib/agent/models.ts` and delete `composer/models.ts` in the same change. Alternatively, let me make (a) and (b) in `Workspace.tsx` myself now. Which one?
4. Answered (orchestrator): AI-CORE adds `AgentDataParts` and `AgentMessage`, and its stream writes a `data-denied` part next to the tool error; wire-up renders `DeniedCall` from that once it lands. Original question: how will a policy-denied call reach the UI? AI-CORE's plan returns it to the model as a tool error. If it arrives as an ordinary `output-error` tool part, the chat can't tell it from a real error. A `DeniedCall` on the turn, or a data part, would let me render `DeniedCall` instead.

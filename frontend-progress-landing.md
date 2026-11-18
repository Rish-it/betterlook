# FE-A progress: landing screen and app scaffold

## Shared contract additions

- Borderless (founder requirement, every UI item): no visible borders, outlines or divider lines on page, composer, top bar, chat column, message bubbles, preview pane or preview toolbar. Separate regions with spacing and subtle Astryx surface/background token differences (light and dark). Resizable divider shows no line at rest; handle only on hover, drag and keyboard focus. Keyboard focus rings stay visible. Prefer Astryx variants/props that drop borders; otherwise StyleX override through the component's style prop, never global CSS. Checked in every UI screenshot.

## Checklist

- [x] Research: use the agent-reach skill to look at how ChatGPT, Claude and Grok web lay out their landing composer. Write a short component map in the progress file: each part of the landing screen and composer, and the Astryx component for it. Flag anything Astryx doesn't cover.
  Sources (agent-reach: Exa search, Jina reader, gh): ChatGPT teardown https://typenorm.com/articles/chatgpt-ux-teardown ; Grok https://fudge.design/share/grok.com-design ; Claude https://fudge.design/share/claude.ai-design ; Astryx source github.com/meta/astryx `packages/core/src/Chat/ChatComposer.doc.mjs`. Exa rate-limited on the Claude query; Claude detail comes from the Fudge teardown only.

  Shared pattern: empty page, one centred vertical stack. Short greeting heading, then one wide rounded composer. Attach (+) at the start of the composer, model/mode picker in the toolbar, round send button at the end that turns from dim to active once there is text. Cursor already in the field. No extra cards around it.

  Component map (all `@astryxdesign/core`):
  | Part | Astryx |
  |---|---|
  | Page frame, centring | `Center` + `VStack` (gap) |
  | Greeting | `Heading` |
  | Composer shell (frame, input, toolbar rows, send) | `ChatComposer` (`onSubmit`, `placeholder`, `headerActions`/`footerActions`/`sendActions` slots) |
  | Multi-line input, Enter sends, Shift+Enter newline | `ChatComposerInput` (default input of `ChatComposer`, keyboard via `useChatKeyboard`) |
  | Send button, disabled when empty | `ChatSendButton` (default `sendButton`) |
  | Attach button | `IconButton` + `Icon` (in `footerActions`) |
  | Model picker | `Selector` (in `footerActions`), mock model list |
  | Tooltip on icon buttons | `Tooltip` |

  Gaps: none blocking. `ChatComposer.onSubmit(value)` gives only text, so `Composer` holds the model in state and calls the contract's `onSubmit(text, model)`. Contract's `autoFocus` has no listed ChatComposer prop; to check at build time (fall back to focusing the input via ref/context).
- [x] Scaffold `apps/web` with Next.js + Bun + TypeScript + Astryx + StyleX per Astryx's Next.js guide; `bun dev` shows a blank page and root `bun run typecheck` passes. Commit as soon as it passes and write the commit hash under the item: FE-B is waiting on it.
  Commit: `ea227024` (`build(web): scaffold Next.js app with Astryx and StyleX`).
  Setup follows Astryx `apps/example-nextjs-stylex` (dist CSS + StyleX babel/postcss plugin, Astryx layers before StyleX layers, neutral theme, `LinkProvider` with `next/link`). Root `bun dev` serves port 3100; root `bun run typecheck` runs `tsc --noEmit` in `apps/web`. `agentRules: false` stops `next dev` writing `apps/web/AGENTS.md`. StyleX verified by a throwaway class appearing in emitted CSS.
  Screenshot: `.screenshots/02-scaffold-blank.png`: blank page, theme background (dark, follows system), no borders.
- [ ] Landing screen at `/`: a short greeting above a centered Composer, with ModelPicker, attach and send in its toolbar, per the contract.
- [ ] Send transition: submitting the Composer navigates to `/workspace?prompt=…&model=…` per the contract. Prove it with a screenshot of the URL after sending (the route itself is FE-B's and may 404 on your branch; that is fine).
- [ ] Polish: empty, narrow-window (about 400px) and keyboard states of the landing screen look and work right.

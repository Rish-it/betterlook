# FE-A progress: landing screen and app scaffold

## Shared contract additions

- Borderless (founder requirement, every UI item): no visible borders, outlines or divider lines on page, composer, top bar, chat column, message bubbles, preview pane or preview toolbar. Separate regions with spacing and subtle Astryx surface/background token differences (light and dark). Resizable divider shows no line at rest; handle only on hover, drag and keyboard focus. Keyboard focus rings stay visible. Prefer Astryx variants/props that drop borders; otherwise StyleX override through the component's style prop, never global CSS. Checked in every UI screenshot.
- Composer controlled model (orchestrator decision): `Composer` takes optional `model?: string` and `onModelChange?(model: string): void`. With `model` given it is controlled: ModelPicker shows that value, a pick calls `onModelChange`, and `onSubmit(text, model)` passes the current value. Without it Composer keeps its own state as before; the landing screen does not pass it.

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
- [x] Landing screen at `/`: a short greeting above a centered Composer, with ModelPicker, attach and send in its toolbar, per the contract.
  Commit: `f284d682`. Files: `src/app/page.tsx`, `src/composer/Composer.tsx`, `src/composer/ModelPicker.tsx`, `src/composer/models.ts`.
  `Composer` = Astryx `ChatComposer` + `ChatComposerInput` (handle `focus()` gives `autoFocus`) with `IconButton` attach and `Selector` ModelPicker in `footerActions`; default `ChatSendButton` disabled while empty (checked). Borderless: `elevation="none"` plus StyleX `xstyle` on the composer body (transparent border, no inset hover/focus rings, `--color-background-muted` fill); keyboard focus outline kept. Astryx has no paperclip icon, so attach uses `upload`. react-doctor 100/100.
  Screenshots: `.screenshots/03-landing-light.png`, `03-landing-typed-dark.png` (focused, focus ring visible), `03-landing-rest-light.png`, `03-landing-rest-dark.png` (no borders, tone difference only).
- [x] Send transition: submitting the Composer navigates to `/workspace?prompt=…&model=…` per the contract. Prove it with a screenshot of the URL after sending (the route itself is FE-B's and may 404 on your branch; that is fine).
  Commit: `0a195121`. `page.tsx` pushes `/workspace?${new URLSearchParams({prompt, model})}` via `next/navigation`.
  Checked in Chrome: Shift+Enter adds a newline without sending; Enter sends `"Make the header blue\nand bold"` with `model=gpt-5` after picking GPT-5; clicking Send carries `&`, `%` and `?` intact (`URLSearchParams` encoding).
  Screenshots: `.screenshots/04-send-enter-url.png`, `.screenshots/04-send-click-url.png` (URL banner injected for the shot; `/workspace` 404s on this branch as expected).
- [x] Polish: empty, narrow-window (about 400px) and keyboard states of the landing screen look and work right.
  Orchestrator review of f284d682: focused composer must not show a ring around the whole box. Show input focus by a slight background tone lift on the composer instead. Keep focus-visible rings on attach, model picker and send. Screenshot both themes.
  Orchestrator: set `devIndicators: false` in `apps/web/next.config.mjs` (dev badge overlaps the composer in screenshots).
  Commit: `a4163737`.
  Root cause of missing focus rings: app StyleX emitted the same atomic class names as Astryx (`x1t137rt` = `outline-style:none`) in a later layer, overriding Astryx's `:focus-visible` rule. `classNamePrefix: 'p'` in `babel.config.js` (as Astryx's example does) separates them.
  Composer: no ring or border when focused; `:focus-within` lifts the fill 5% toward text colour (light 241 to 229, dark 27 to 38). Attach, model picker and send show the Astryx focus-visible ring on Tab. `devIndicators: false` hides the Next badge.
  Checked at 1280 and 400 px, light and dark: no horizontal scroll at 400 px; Enter on empty or whitespace stays on `/` with Send disabled; Tab order Message, Attach, Model, Send; Enter on Send navigates.
  Screenshots: `.screenshots/05-{wide,narrow}-{light,dark}-{focused-empty,rest,tab-attach,tab-model,tab-send}.png`.
  Skipped: favicon (`/favicon.ico` 404 in the console), add when there is an icon.
  Contract change done as part of Polish: commit `1c6c0f63` (`feat(composer): optional controlled model via model and onModelChange`). Verified with a throwaway controlled parent (reverted): picker shows the parent's value, a pick calls `onModelChange`, submit sends the parent's value; landing (uncontrolled) unchanged.

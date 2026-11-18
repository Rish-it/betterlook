# FE-B progress: workspace screen

Owner: FE-B. Files: `apps/web/src/app/workspace/`, `apps/web/src/workspace/`. Dev server port 3200.

## Shared contract additions

- Borderless look (founder, via orchestrator): no visible borders, outlines or divider lines on page, composer, top bar, chat column, message bubbles, preview pane or preview toolbar. Regions separate by spacing and subtle Astryx surface/background token tone, light and dark. Resizable divider shows no line at rest; handle only on hover, drag, keyboard focus. Keyboard focus rings stay visible. Drop borders via Astryx variants/props first, else StyleX through the component's style prop, never global CSS. Checked in every UI screenshot.

## Checklist

- [x] Research: use the agent-reach skill to look at how v0, Lovable and Emergent lay out their chat + preview workspace. Write a short component map in this file: top bar, chat column, message list, pinned composer, preview pane and its toolbar, resizable divider, and the Astryx component for each. Flag anything Astryx doesn't cover.
  - No screenshot (research only). No `package.json` on branch yet, so `bun run typecheck` has nothing to run; covered by the scaffold item.

### Research notes

All three use the same shape: a slim top bar, chat on the left, a live preview on the right.

- v0: chat left, running app right; the preview has a mobile-viewport toggle, sandbox status and a Logs tab. Source: https://www.saasui.design/application/v0
- Lovable: chat panel left, preview right, top bar holds project controls; a toolbar switches Preview/Files/Code; Cmd+B hides the chat to give the preview the full window; on small windows controls collapse into overflow menus and mobile shows the areas as swipeable views. Source: https://docs.lovable.dev/features/projects/editor
- Emergent: chat panel (attachments in the input) plus a preview panel that auto-refreshes and can open in a new browser tab. Source: https://help.emergent.sh/a-tour-of-the-workspace

Taken for Betterlook: chat left / preview right, preview toolbar with refresh and open-in-new-tab, one top bar. Skipped (no failure drives it): Files/Code/Logs tabs, mobile-viewport toggle, chat hide shortcut.

### Component map

Source of component list: `docs/specs/components/` in github.com/meta/astryx.

| Region | Astryx component |
|---|---|
| Page frame | `AppShell` (`topNav`, `children`, `height="fill"`) |
| Top bar | `TopNav` (`heading` = project name, `endContent` = FE-A `ModelPicker`) |
| Chat column | `ChatLayout` (`composer` slot docks the composer at the bottom; transcript scrolls under it) |
| Message list | `ChatMessageList` + `ChatMessage` / `ChatMessageBubble` |
| Pinned composer | FE-A `Composer` in `ChatLayout`'s `composer` slot (Astryx `ChatComposer` exists, but the contract fixes FE-A's) |
| Preview pane | `Layout`/`Stack` container holding a native `<iframe>` |
| Preview toolbar | `Toolbar` (one tab stop, arrow keys between controls) + `IconButton` refresh and open-in-new-tab |
| Resizable divider | `useResizable` + `ResizeHandle` (`label`, keyboard support per its a11y tests) |
| Iframe loading | `Spinner` (or `Skeleton`) over the iframe until `onLoad` |
| Narrow window | `AppShell` mobile layout for the top bar; chat/preview switch via `SegmentedControl` or `TabList` |

### Gaps in Astryx

- No iframe / browser-frame component: native `<iframe>` inside an Astryx container. Not a decision, just noted.
- No "split pane" component as such: `useResizable` is a hook plus a handle, so the two-pane flex row is a plain StyleX container.
- [x] Get the scaffold: FE-A builds `apps/web`. If it isn't on this branch yet, stop the round and end with SUPERSET_WORKER_BLOCKED, needs: "FE-A scaffold". The orchestrator says when to run `git merge betterlook`. Tick once it is merged and root `bun run typecheck` passes.
  - Merged `betterlook` (ea227024) in 31a9422b; `bun install` done; root `bun run typecheck` exit 0, two runs. No UI, no screenshot. Dev server for FE-B: `cd apps/web && bunx next dev --port 3200`.
- [x] Workspace screen at `/workspace`: slim top bar with project name and model picker; chat on the left with the `prompt` search param as the user's message (fixed mock if absent) plus a mock assistant reply, composer pinned at the bottom; live preview on the right as an iframe pointed at a placeholder page served at `/workspace/preview`, with a small toolbar for refresh and open-in-new-tab; resizable divider between chat and preview. Use FE-A's `Composer` and `ModelPicker` if on this branch; otherwise clearly marked placeholders and no imports from `src/composer/`.
  - `.screenshots/workspace-1440-light.png`, `.screenshots/workspace-1440-dark.png`: top bar, prompt as user message (mock when absent), mock reply, pinned composer slot, preview iframe + refresh/open toolbar; borderless in light and dark, divider line invisible at rest. Divider resizes: keyboard ArrowRight x5 504 to 554px, drag 554 to 354px. Typecheck two runs exit 0; react-doctor 100/100.
  - Composer and ModelPicker are marked placeholders (FE-A's not on `betterlook` yet).
  - Preview is a self-contained HTML route (`workspace/preview/route.ts`) in a sandboxed iframe without `allow-same-origin`: Next dev returns 403 to `Origin: null` requests, so a Next page in the strict sandbox lost its CSS and JS; react-doctor flags `allow-scripts` + `allow-same-origin` together.
  - Astryx has no refresh icon; refresh uses a small inline SVG passed to `Icon`, as Astryx's Icon docs direct.
- [ ] Polish: narrow window (~400px), iframe loading, and keyboard use of the divider and toolbar look and work right.
  - In progress, not ticked (blocked on Q1 below). Done so far: merged `betterlook` 86718025; FE-A `Composer` and `ModelPicker` replace the placeholders; top-bar picker starts from the `model` param; mock reply is generic; sends in the workspace append to the chat.
  - `.screenshots/e2e-workspace-1440.png`: typed on `/`, Enter, landed on `/workspace?prompt=Make+the+nav+sticky&model=gpt-5`; message shown, top picker GPT-5.
  - `.screenshots/workspace-400-chat.png`, `.screenshots/workspace-400-preview.png`: below 640px a SegmentedControl switches Chat/Preview, divider hidden, no horizontal scroll (scrollWidth 400). Borderless holds.
  - `.screenshots/divider-focus-1440.png`: divider shows no line at rest, a focus ring only on keyboard focus. Toolbar: ArrowRight moves focus Refresh to Open-in-new-tab.
  - Iframe loading: Spinner over the frame until `onLoad`, again on refresh; `aria-busy` on the preview section.
  - Typecheck two runs exit 0; react-doctor 100/100.

## Questions

- Resolved: FE-A scaffold merged.
- Q1 (blocks Polish): FE-A's `Composer` keeps its own model state, always starting at `MODELS[0]` (Claude Sonnet 5.5), and the contract gives it no way to receive a model. On `/workspace?model=gpt-5` the top-bar picker shows GPT-5 but the composer's picker shows Claude Sonnet 5.5, and the next send reports Claude Sonnet 5.5, flipping the top bar back. Options: (a) add an optional `model` + `onModelChange` (or `initialModel`) prop to `Composer` (FE-A file, contract change); (b) drop the top-bar picker and let the composer's picker be the only one, accepting that it ignores the `model` param until (a). Recommend (a). Needs orchestrator decision.
  - Decision (orchestrator): option (a). FE-A adds optional `model?: string` and `onModelChange?(model: string): void` to `Composer` (controlled when `model` is given). Top-bar picker stays. FE-B, once it lands on `betterlook`: hold model in workspace state seeded from `?model=`, pass it to both the top-bar `ModelPicker` and the pinned `Composer`. Waiting for FE-A.

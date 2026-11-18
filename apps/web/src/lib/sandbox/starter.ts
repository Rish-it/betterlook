export const PREVIEW_PORT = 5173;

// Section 0 of evals/EVALS.md, verbatim. starter.test.ts fails if the two drift apart.
export const DESIGN_MD = `## 0. Design contract (applies to starter and every edited result)

| Area | Invariant |
|---|---|
| Fonts | Default text: **Geist Sans**. Hero display: **Geist Pixel Square**. Allowed families: Geist Sans, Geist Mono, Geist Pixel Square, generic system fallbacks only. Load actual faces using the \`geist\` package's font files or an appropriate font source compatible with Vite + React. |
| Pixel keywords | \`Betterlook\`, \`New\`, \`Beta\` (case-insensitive, **whole-word**). Each occurrence in its own inline element using Geist Pixel Square; surrounding non-keyword text stays Sans, except the hero display. |
| Mono keywords | \`API\`, \`CLI\`, \`npm\`, \`v1\` (case-insensitive, **whole-word**). Each occurrence in its own inline element using Geist Mono; surrounding text stays Sans unless it is hero display. Mono keywords override the hero's Pixel face inside their own spans. |
| Font restriction | Mono and Pixel may only appear on the specified keyword spans, and Pixel may additionally appear on the hero display text. No other special-font use. |
| Hero | \`[data-section="hero"]\` contains in DOM order: \`h1\` (Geist Pixel Square), **one-line** Sans intro, primary button. Child wrappers are allowed only if the required order and semantics remain unambiguous. |
| Color | Every visible CSS-computed color has **OKLCH chroma ≤ 0.02**. Inspect text, backgrounds, gradients, CSS-generated content, borders, outlines, shadows and CSS-styled SVG. Exclude the image/video/canvas *content*, not other CSS on those elements. Light theme mandatory; test both if dark mode existed in the starter. |
| Borderless | No visible CSS border or visible \`<hr>\`. Outlines can be visible only in \`:focus-visible\`. Separate surfaces via grayscale shade or shadow ring (spread ≤ **1px**, effective opacity ≤ **10%**). |
| Typography | \`text-wrap: balance\` on headings; \`text-wrap: pretty\` on body copy; computed letter spacing ≤ **−0.01em** for text ≥ **24px**; \`-webkit-font-smoothing: antialiased\` on \`html\`; \`font-variant-numeric: tabular-nums\` for visible numbers. |
| Geometry | For genuinely nested rounded surfaces, \`outer radius = inner radius + actual inset\` within **±1px** for each applicable corner. Click targets ≥ **24×24px**; icon-only buttons ≥ **32×32px**. |
| Motion | Pressed button scales to **0.95–0.98**. Transition affects \`transform\` only, duration **100–150ms**. Under reduced motion, disable the transition. |
| Page | Set a nontransparent \`html\` background. No writes outside the task's \`allowed_files\`. |
`;

export const STARTER_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'betterlook-starter',
      private: true,
      type: 'module',
      scripts: {
        dev: `vite --host 0.0.0.0 --port ${PREVIEW_PORT}`,
        build: 'vite build',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {geist: '1.9.2', react: '19.3.1', 'react-dom': '19.3.1'},
      devDependencies: {
        '@types/react': '19.3.0',
        '@types/react-dom': '19.3.0',
        '@vitejs/plugin-react': '6.3.0',
        typescript: '6.0.3',
        vite: '8.3.8',
      },
    },
    null,
    2,
  ),
  // geist declares next as a peer dependency; the starter only needs its font files.
  '.npmrc': 'legacy-peer-deps=true\n',
  '.gitignore': 'node_modules\ndist\n',
  'DESIGN.md': DESIGN_MD,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  'vite.config.ts': `import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {alias: {'@geist-fonts': fileURLToPath(new URL('./node_modules/geist/dist/fonts', import.meta.url))}},
  server: {allowedHosts: true, cors: true},
});
`,
  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        types: ['vite/client'],
      },
      include: ['src'],
    },
    null,
    2,
  ),
  'src/main.tsx': `import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  'src/App.tsx': `export function App() {
  return (
    <main className="page">
      <section data-section="hero" className="hero">
        <h1 className="hero-title">Edit your interface in plain words</h1>
        <p className="hero-intro">
          Describe a change and <span className="pixel">Betterlook</span> edits the real code.
        </p>
        <button className="button button-primary">Get started</button>
      </section>

      <section data-section="features" className="section">
        <h2 className="section-title">Why designers use it</h2>
        <div className="cards">
          <article className="card">
            <h3 className="card-title">Real code</h3>
            <p className="card-copy">Every edit lands in your React source, not in a mockup.</p>
          </article>
          <article className="card">
            <h3 className="card-title">Checked edits</h3>
            <p className="card-copy">
              The build, the diff and the page are checked before you hear it worked. <span className="pixel">Beta</span>
            </p>
          </article>
          <article className="card">
            <h3 className="card-title">Open access</h3>
            <p className="card-copy">
              Script changes from the <span className="mono">CLI</span> or call the <span className="mono">API</span>.
            </p>
          </article>
        </div>
      </section>

      <section data-section="pricing" className="section">
        <h2 className="section-title">Pricing</h2>
        <div className="plans">
          <div className="plan">
            <div className="plan-inner">
              <h3 className="card-title">Team</h3>
              <p className="plan-price">$24 per seat</p>
              <p className="card-copy">Unlimited edits and 5 projects.</p>
              <button className="button button-secondary">Choose plan</button>
            </div>
          </div>
        </div>
      </section>

      <footer data-section="footer" className="footer">
        <p className="footer-copy">
          Install with <span className="mono">npm</span>. Current release <span className="mono">v1</span>.
        </p>
      </footer>
    </main>
  );
}
`,
  'src/index.css': `@font-face {
  font-family: 'Geist Sans';
  src: url('@geist-fonts/geist-sans/Geist-Variable.woff2') format('woff2');
  font-weight: 100 900;
  font-display: block;
}

@font-face {
  font-family: 'Geist Mono';
  src: url('@geist-fonts/geist-mono/GeistMono-Variable.woff2') format('woff2');
  font-weight: 100 900;
  font-display: block;
}

@font-face {
  font-family: 'Geist Pixel Square';
  src: url('@geist-fonts/geist-pixel/GeistPixel-Square.woff2') format('woff2');
  font-weight: 500;
  font-display: block;
}

html {
  background: #fafafa;
  color: #171717;
  font-family: 'Geist Sans', system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}

body {
  margin: 0;
}

h1,
h2,
h3 {
  margin: 0;
  text-wrap: balance;
}

p {
  margin: 0;
  text-wrap: pretty;
}

.pixel {
  font-family: 'Geist Pixel Square', monospace;
}

.mono {
  font-family: 'Geist Mono', ui-monospace, monospace;
}

.page {
  display: flex;
  flex-direction: column;
  gap: 64px;
  padding: 0 24px 64px;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 96px;
  text-align: center;
}

.hero-title {
  font-family: 'Geist Pixel Square', monospace;
  font-size: 56px;
  font-weight: 500;
  letter-spacing: -0.02em;
}

.hero-intro {
  font-size: 18px;
  color: #525252;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
}

.section-title {
  font-size: 32px;
  letter-spacing: -0.02em;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
}

.card-title {
  font-size: 18px;
}

.card-copy {
  color: #525252;
}

.plans {
  display: flex;
  gap: 16px;
}

.plan {
  width: 360px;
  padding: 8px;
  border-radius: 16px;
  background: #f0f0f0;
}

.plan-inner {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.06);
}

.plan-price {
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.button {
  min-height: 40px;
  padding: 0 20px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: transform 120ms ease-out;
}

.button:active {
  transform: scale(0.97);
}

.button:focus {
  outline: none;
}

.button:focus-visible {
  outline: 2px solid #171717;
  outline-offset: 2px;
}

.button-primary {
  background: #171717;
  color: #fafafa;
}

.button-secondary {
  background: #e5e5e5;
  color: #171717;
}

.footer {
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  color: #737373;
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }
}
`,
};

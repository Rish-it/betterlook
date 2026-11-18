export const PREVIEW_PORT = 5173;

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
      dependencies: {react: '19.3.1', 'react-dom': '19.3.1'},
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
  '.gitignore': 'node_modules\ndist\n',
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
  'vite.config.ts': `import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({plugins: [react()], server: {allowedHosts: true, cors: true}});
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
    <main className="hero">
      <h1 className="hero-heading">Build something people love</h1>
      <p className="hero-copy">A small React app for Betterlook to edit.</p>
      <button className="hero-button">Get started</button>
    </main>
  );
}
`,
  'src/index.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 96px 24px;
  text-align: center;
}

.hero-heading {
  margin: 0;
  font-size: 48px;
  color: #111;
}

.hero-copy {
  margin: 0;
  color: #555;
}

.hero-button {
  padding: 10px 20px;
  border: 0;
  border-radius: 8px;
  background: #111;
  color: #fff;
  font-size: 16px;
}
`,
};

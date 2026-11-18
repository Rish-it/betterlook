/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DESIGN_MD, STARTER_FILES} from './starter';

test('DESIGN.md is Section 0 of evals/EVALS.md, verbatim', () => {
  const spec = readFileSync(join(import.meta.dir, '../../../../../evals/EVALS.md'), 'utf8');
  const section = spec.slice(spec.indexOf('## 0. Design contract'), spec.indexOf('### Scoring contract')).trimEnd();
  expect(DESIGN_MD).toBe(`${section}\n`);
  expect(STARTER_FILES['DESIGN.md']).toBe(DESIGN_MD);
});

test('the starter hero has an h1, a one-line intro and a primary button, and loads the three Geist faces', () => {
  const app = STARTER_FILES['src/App.tsx'];
  expect(app).toMatch(/data-section="hero"[\s\S]*<h1[\s\S]*<p className="hero-intro">[\s\S]*<button className="button button-primary">/);
  for (const file of ['geist-sans/Geist-Variable.woff2', 'geist-mono/GeistMono-Variable.woff2', 'geist-pixel/GeistPixel-Square.woff2']) {
    expect(STARTER_FILES['src/index.css']).toContain(`@geist-fonts/${file}`);
  }
});

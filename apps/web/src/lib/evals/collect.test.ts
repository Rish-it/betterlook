import {expect, test} from 'bun:test';
import {hookModule} from './collect';

test('does not take a screenshot when collected page text contains a canary', async () => {
  const sensitive = `blk_${crypto.randomUUID().replaceAll('-', '')}`;
  let screenshots = 0;
  const run = new Function('writeFileSync', hookModule({target: null, expect: [], screenshot: true}).replace("import {writeFileSync} from 'node:fs';", '').replace('export default', 'return'))(() => {});
  await run({
    emulateMedia: async () => {},
    evaluate: async (fn: unknown) => typeof fn === 'string' ? {pressIndexes: [], pageText: sensitive} : undefined,
    mouse: {move: async () => {}},
    screenshot: async () => {screenshots++;},
  });
  expect(screenshots).toBe(0);
});

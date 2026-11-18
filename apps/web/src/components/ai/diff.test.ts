import {expect, test} from 'bun:test';
import {parseDiff} from './diff';
import {turnDiff} from './fixtures';

test('splits a unified diff per file with line counts', () => {
  expect(parseDiff(turnDiff).map(({path, additions, deletions}) => ({path, additions, deletions}))).toEqual([
    {path: 'src/components/Hero.tsx', additions: 1, deletions: 1},
    {path: 'src/styles/tokens.css', additions: 2, deletions: 0},
  ]);
  expect(parseDiff(turnDiff)[0].patch.startsWith('@@ -1,7 +1,7 @@')).toBe(true);
});

test('uses the old path for a deleted file and handles an empty diff', () => {
  const deleted = 'diff --git a/src/Old.tsx b/src/Old.tsx\ndeleted file mode 100644\n--- a/src/Old.tsx\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n';
  expect(parseDiff(deleted)).toMatchObject([{path: 'src/Old.tsx', additions: 0, deletions: 2}]);
  expect(parseDiff('')).toEqual([]);
});

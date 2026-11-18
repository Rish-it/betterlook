import {expect, test} from 'bun:test';
import {summarizeArgs} from './summarize';

test('prefers path, then command, then any string', () => {
  expect(summarizeArgs({oldText: 'a', path: 'src/Hero.tsx'})).toBe('src/Hero.tsx');
  expect(summarizeArgs({command: 'ls'})).toBe('ls');
  expect(summarizeArgs({foo: 1, bar: 'x'})).toBe('x');
});

test('handles empty and non-object args, and truncates', () => {
  expect(summarizeArgs({})).toBeUndefined();
  expect(summarizeArgs(null)).toBeUndefined();
  expect(summarizeArgs({path: 'a'.repeat(80)}, 10)).toBe('aaaaaaaaa…');
});

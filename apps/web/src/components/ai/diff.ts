export type FileDiff = {path: string; additions: number; deletions: number; patch: string};

export const hunks = (patch: string) => {
  const lines = patch.split('\n');
  return lines.slice(Math.max(0, lines.findIndex(l => l.startsWith('@@')))).join('\n').trimEnd();
};

export function parseDiff(diff: string): FileDiff[] {
  return diff
    .split(/^(?=diff --git )/m)
    .filter(chunk => chunk.startsWith('diff --git '))
    .map(chunk => {
      const lines = chunk.split('\n');
      const plus = lines.find(l => l.startsWith('+++ '))?.slice(4);
      const path = plus && plus !== '/dev/null' ? plus.replace(/^b\//, '') : (lines[0].match(/ a\/(\S+)/)?.[1] ?? '');
      const body = lines.filter(l => !l.startsWith('+++') && !l.startsWith('---'));
      return {
        path,
        additions: body.filter(l => l.startsWith('+')).length,
        deletions: body.filter(l => l.startsWith('-')).length,
        patch: hunks(chunk),
      };
    });
}

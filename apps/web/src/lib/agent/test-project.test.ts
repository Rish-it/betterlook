import {expect, test} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tempProject} from './test-project';

test('temporary projects ignore inherited git repository, worktree and index paths', async () => {
  const other = tempProject({'original.txt': 'untouched'});
  try {
    await other.project.run('git', ['config', 'user.name', 'original']);
    const config = join(other.root, '.git/config');
    const before = readFileSync(config, 'utf8');
    const index = readFileSync(join(other.root, '.git/index'));
    const output = execFileSync(process.execPath, ['--no-env-file', '-e', `
      import {realpathSync} from 'node:fs';
      import {tempProject} from ${JSON.stringify(import.meta.resolve('./test-project'))};
      const t = tempProject({'local.txt': 'local'});
      try {
        const root = await t.project.run('git', ['rev-parse', '--show-toplevel']);
        const file = await t.project.run('git', ['show', 'HEAD:local.txt']);
        await t.project.run('git', ['config', 'core.bare', 'true']);
        console.log(JSON.stringify({local: root.output.trim() === realpathSync(t.root), file}));
      } finally { t.cleanup(); }
    `], {env: {...process.env, GIT_DIR: join(other.root, '.git'), GIT_WORK_TREE: other.root, GIT_INDEX_FILE: join(other.root, '.git/index')}}).toString();
    expect(readFileSync(config, 'utf8')).toBe(before);
    expect(readFileSync(join(other.root, '.git/index'))).toEqual(index);
    expect(JSON.parse(output)).toEqual({local: true, file: {exitCode: 0, output: 'local'}});
  } finally {
    other.cleanup();
  }
});

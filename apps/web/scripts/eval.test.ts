import {expect, test} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

test('--task selects one frozen task for a one-trial smoke run', () => {
  const out = mkdtempSync(join(tmpdir(), 'betterlook-eval-cli-'));
  try {
    const plan = JSON.parse(execFileSync(process.execPath, ['--no-env-file', resolve(import.meta.dir, 'eval.ts'), '--tasks', resolve(import.meta.dir, '../../../evals/tasks/v1.md'), '--task', 'copy-edit', '--runs', '1', '--model', 'claude-haiku-5-5', '--dry-run', '--out', out], {env: {...process.env, LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: ''}}).toString());
    expect(plan.expected_executions).toBe(1);
    expect(plan.tasks.map((t: {id: string}) => t.id)).toEqual(['copy-edit']);
    expect(plan.taskset_hash).toBe('5c33dfd1df6cb9c9b7222412bfd7e5337343f4165aa08b981a7aa10a01d08e60');
  } finally {
    rmSync(out, {recursive: true, force: true});
  }
});

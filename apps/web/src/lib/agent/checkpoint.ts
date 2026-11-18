import type {Project} from '../sandbox/project';
import type {Checkpoint, TurnDiff} from './types';

const COMMIT = /^[0-9a-f]{7,40}$/;

async function git(project: Project, args: string[]) {
  const {exitCode, output} = await project.run('git', args);
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed (exit ${exitCode})`);
  return output.trim();
}

const head = (project: Project) => git(project, ['rev-parse', 'HEAD']);

export async function commitTurn(project: Project, turnId: string, base?: string): Promise<{checkpoint: Checkpoint; diff: TurnDiff} | null> {
  await git(project, ['add', '-A']);
  if (!(await git(project, ['diff', '--cached', '--name-only']))) return null;
  const parentId = await head(project);
  const from = base ?? parentId;
  const diff = await git(project, ['diff', '--cached', from]);
  const filesTouched = (await git(project, ['diff', '--cached', '--name-only', from])).split('\n').filter(Boolean);
  await git(project, ['commit', '-q', '-m', `turn ${turnId}`]);
  return {
    checkpoint: {id: await head(project), parentId: from, sandboxId: project.id, turnId, createdAt: new Date().toISOString()},
    diff: {diff, filesTouched},
  };
}

export async function restoreCheckpoint(project: Project, checkpointId: string): Promise<string> {
  if (!COMMIT.test(checkpointId)) throw new Error('Not a checkpoint id.');
  await git(project, ['read-tree', '-u', '--reset', checkpointId]);
  await git(project, ['commit', '-q', '--allow-empty', '-m', `restore ${checkpointId}`]);
  return head(project);
}

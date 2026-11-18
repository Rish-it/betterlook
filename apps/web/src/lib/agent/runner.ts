import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {LanguageModel} from 'ai';
import type {Project} from '../sandbox/project';
import {CHECKER_DIR, CHECKER_SCRIPT} from '../sandbox/runtime-check';
import {PREVIEW_PORT} from '../sandbox/starter';
import {RUNNER_CONFIG} from './config';
import {RATE_LIMITED} from './errors';
import {runAgent} from './run';
import {maskSecrets} from './trace';
import type {ProviderCredential, TurnStatus} from './types';

export type Task = {id: string; prompt: string} & Record<string, unknown>;
export type RunSummary = {taskId: string; run: number; status: TurnStatus; attempts: number; dir: string};

type Deps = {
  model: () => Exclude<LanguageModel, string>;
  project: () => Promise<Project>;
  capture: (project: Project) => Promise<Uint8Array | null>;
  sleep?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
};

export function parseTasks(value: unknown): Task[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('The task file must be a non-empty JSON array.');
  const ids = new Set<string>();
  return value.map((task: Record<string, unknown> | null, i) => {
    const id = task?.id;
    if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) throw new Error(`Task ${i} needs an id of letters, digits, ".", "-" or "_".`);
    if (typeof task?.prompt !== 'string' || !task.prompt) throw new Error(`Task ${id} needs a prompt.`);
    if (ids.has(id)) throw new Error(`Task id ${id} is used twice.`);
    ids.add(id);
    return task as Task;
  });
}

export function evalCredential(env: Record<string, string | undefined>): ProviderCredential {
  const apiKey = env.OPENAI_EVAL_API_KEY;
  if (!apiKey) throw new Error('Set OPENAI_EVAL_API_KEY in apps/web/.env. The runner never uses a user key.');
  return {provider: 'openai', kind: 'api-key', apiKey};
}

const SHOT = `${CHECKER_DIR}/preview.png`;

export async function previewScreenshot(project: Project, sleep: (ms: number) => Promise<unknown> = delay) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const {exitCode} = await project.run('node', [CHECKER_SCRIPT, `http://localhost:${PREVIEW_PORT}`, SHOT]);
    if (exitCode === 0) return project.readBytes(SHOT);
    await sleep(3_000);
  }
  return null;
}

async function runOnce(task: Task, run: number, outDir: string, deps: Required<Deps>): Promise<RunSummary> {
  for (let attempt = 1; ; attempt++) {
    const project = await deps.project();
    const before = await deps.capture(project);
    const {stream, turn} = runAgent({model: deps.model(), messages: [{role: 'user', content: task.prompt}], project});
    for await (const _ of stream);
    const record = await turn;
    if (record.error === RATE_LIMITED && attempt < RUNNER_CONFIG.maxAttempts) {
      const wait = RUNNER_CONFIG.backoffMs * 2 ** (attempt - 1);
      deps.log(`${task.id} run ${run}: rate limited, retrying in ${wait / 1000}s`);
      await deps.sleep(wait);
      continue;
    }
    const after = await deps.capture(project);
    const dir = join(outDir, task.id, `run-${run}`);
    const json = (value: unknown) => maskSecrets(JSON.stringify(value, null, 2));
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, 'task.json'), json(task));
    await writeFile(join(dir, 'turn.json'), json(record));
    await writeFile(join(dir, 'diff.patch'), maskSecrets(record.diff));
    await writeFile(join(dir, 'verify.json'), json({verify: record.verify, repairAttempted: record.repairAttempted, repairVerify: record.repairVerify}));
    if (before) await writeFile(join(dir, 'before.png'), before);
    if (after) await writeFile(join(dir, 'after.png'), after);
    deps.log(`${task.id} run ${run}: ${record.status}`);
    return {taskId: task.id, run, status: record.status, attempts: attempt, dir};
  }
}

export async function runTasks({
  tasks,
  runs,
  outDir,
  concurrency = RUNNER_CONFIG.concurrency,
  ...deps
}: {tasks: Task[]; runs: number; outDir: string; concurrency?: number} & Deps): Promise<RunSummary[]> {
  const all: Required<Deps> = {sleep: delay, log: () => {}, ...deps};
  const jobs = tasks.flatMap(task => Array.from({length: runs}, (_, i) => ({task, run: i + 1})));
  const results: RunSummary[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const {task, run} = jobs[next++];
      results.push(await runOnce(task, run, outDir, all));
    }
  };
  await Promise.all(Array.from({length: Math.min(concurrency, jobs.length)}, worker));
  return results;
}

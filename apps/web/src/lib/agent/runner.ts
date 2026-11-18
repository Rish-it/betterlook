import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {LanguageModel} from 'ai';
import {parseExpectation} from '../evals/checks';
import type {Project} from '../sandbox/project';
import {CHECKER_DIR, CHECKER_SCRIPT} from '../sandbox/runtime-check';
import {PREVIEW_PORT} from '../sandbox/starter';
import {RUNNER_CONFIG} from './config';
import {RATE_LIMITED, SANDBOX_QUOTA, sandboxQuotaExceeded} from './errors';
import {runAgent} from './run';
import {maskSecrets} from './trace';
import type {ProviderCredential, ProviderId, SandboxUsage, TurnRecord, TurnStatus} from './types';

export type Task = {id: string; prompt: string} & Record<string, unknown>;
export type RunSummary = {taskId: string; run: number; status: TurnStatus; attempts: number; dir: string; evaluation?: unknown};

export interface RunContext {
  task: Task;
  run: number;
  project: Project;
  record: TurnRecord;
  before: Uint8Array | null;
  after: Uint8Array | null;
}

type Deps = {
  model: () => Exclude<LanguageModel, string>;
  project: () => Promise<Project>;
  capture: (project: Project, task: Task, phase: 'before' | 'after') => Promise<Uint8Array | null>;
  // Extra runAgent options for a task (the eval collector job, trace attributes).
  agent?: (task: Task, run: number) => Omit<Parameters<typeof runAgent>[0], 'model' | 'messages' | 'project'>;
  // Scores a finished run while its sandbox is still up; the result is written to evals.json.
  evaluate?: (context: RunContext) => Promise<unknown>;
  // Checked before each new job, e.g. a spend cap; false stops scheduling.
  proceed?: () => boolean;
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

const STARTERS = ['default'];

const EVAL_IDS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'];
const commaList = (value: string) => value.split(',').map(v => v.trim()).filter(Boolean);

// The founder's Markdown task format: one "## <task id>" section per task with "prompt:", "starter:" and "notes:" lines,
// plus the EVALS.md §9 fields "expect:" (one JSON assertion per "- " line), "allowed_files:", "tags:", "applies:" and "target:".
// Notes are for the founder and never reach the runner; anything before the first heading is ignored.
export function parseTaskMarkdown(text: string): Task[] {
  const sections = text.split(/^## +/m).slice(1);
  if (!sections.length) throw new Error('The task file has no "## <task id>" sections.');
  return parseTasks(
    sections.map(section => {
      const [heading, ...lines] = section.split('\n');
      const id = heading.trim();
      const field = (name: string) => lines.find(l => l.startsWith(`${name}:`))?.slice(name.length + 1).trim();
      const prompt = field('prompt');
      if (!prompt) throw new Error(`Task ${id} needs a prompt.`);
      const starter = field('starter') || 'default';
      if (!STARTERS.includes(starter)) throw new Error(`Task ${id} uses starter "${starter}"; available: ${STARTERS.join(', ')}.`);
      const task: Task = {id, prompt, starter};
      const at = lines.findIndex(l => l.trim() === 'expect:');
      if (at >= 0) {
        const items = lines.slice(at + 1).filter((l, i, all) => all.slice(0, i + 1).every(x => x.startsWith('- ')));
        if (!items.length) throw new Error(`Task ${id} has an empty expect: list.`);
        task.expect = items.map(line => {
          try {
            return parseExpectation(JSON.parse(line.slice(2)));
          } catch (error) {
            throw new Error(`Task ${id} has an invalid expectation ${line.slice(2)}: ${(error as Error).message}`);
          }
        });
      }
      const allowed = field('allowed_files');
      if (allowed !== undefined) task.allowed_files = commaList(allowed);
      const tags = field('tags');
      if (tags !== undefined) task.tags = commaList(tags);
      const applies = field('applies');
      if (applies !== undefined) {
        task.applies = commaList(applies);
        const unknown = (task.applies as string[]).filter(e => !EVAL_IDS.includes(e));
        if (unknown.length) throw new Error(`Task ${id} applies unknown evals: ${unknown.join(', ')}.`);
      }
      const target = field('target');
      if (target !== undefined) task.target = target;
      return task;
    }),
  );
}

const EVAL_KEYS: Record<ProviderId, string> = {openai: 'OPENAI_EVAL_API_KEY', anthropic: 'ANTHROPIC_EVAL_API_KEY'};

export function evalCredential(provider: ProviderId, env: Record<string, string | undefined>): ProviderCredential {
  const apiKey = env[EVAL_KEYS[provider]];
  if (!apiKey) throw new Error(`Set ${EVAL_KEYS[provider]} in apps/web/.env. The runner never uses a user key.`);
  return {provider, kind: 'api-key', apiKey};
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
    let record: TurnRecord;
    let before: Uint8Array | null;
    let after: Uint8Array | null = null;
    let usage: SandboxUsage | null = null;
    let evaluation: unknown;
    try {
      before = await deps.capture(project, task, 'before');
      const {stream, turn} = runAgent({...deps.agent(task, run), model: deps.model(), messages: [{role: 'user', content: task.prompt}], project, keepSandbox: true});
      for await (const _ of stream);
      record = await turn;
      if (record.error !== RATE_LIMITED) {
        after = await deps.capture(project, task, 'after');
        evaluation = await deps.evaluate?.({task, run, project, record, before, after}).catch((error: unknown) => ({error: maskSecrets(error instanceof Error ? error.message : String(error))}));
      }
    } finally {
      usage = (await project.stop?.().catch(() => null)) ?? null;
    }
    record.sandbox = usage;
    if (record.error === RATE_LIMITED && attempt < RUNNER_CONFIG.maxAttempts) {
      const wait = RUNNER_CONFIG.backoffMs * 2 ** (attempt - 1);
      deps.log(`${task.id} run ${run}: rate limited, retrying in ${wait / 1000}s`);
      await deps.sleep(wait);
      continue;
    }
    const dir = join(outDir, task.id, `run-${run}`);
    const json = (value: unknown) => maskSecrets(JSON.stringify(value, null, 2));
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, 'task.json'), json(task));
    await writeFile(join(dir, 'turn.json'), json(record));
    await writeFile(join(dir, 'diff.patch'), maskSecrets(record.diff));
    await writeFile(join(dir, 'verify.json'), json({verify: record.verify, repairAttempted: record.repairAttempted, repairVerify: record.repairVerify}));
    if (before) await writeFile(join(dir, 'before.png'), before);
    if (after) await writeFile(join(dir, 'after.png'), after);
    if (evaluation !== undefined) await writeFile(join(dir, 'evals.json'), json(evaluation));
    deps.log(`${task.id} run ${run}: ${record.status}, sandbox ${JSON.stringify(record.sandbox)}`);
    return {taskId: task.id, run, status: record.status, attempts: attempt, dir, ...(evaluation === undefined ? {} : {evaluation})};
  }
}

export async function runTasks({
  tasks,
  runs,
  outDir,
  concurrency = RUNNER_CONFIG.concurrency,
  ...deps
}: {tasks: Task[]; runs: number; outDir: string; concurrency?: number} & Deps): Promise<RunSummary[]> {
  const all: Required<Deps> = {sleep: delay, log: () => {}, agent: () => ({}), evaluate: async () => undefined, proceed: () => true, ...deps};
  const jobs = tasks.flatMap(task => Array.from({length: runs}, (_, i) => ({task, run: i + 1})));
  const results: RunSummary[] = [];
  let next = 0;
  let paused = false;
  const worker = async () => {
    while (!paused && next < jobs.length && all.proceed()) {
      const {task, run} = jobs[next++];
      try {
        results.push(await runOnce(task, run, outDir, all));
      } catch (error) {
        if (!sandboxQuotaExceeded(error)) throw error;
        if (!paused) all.log(SANDBOX_QUOTA);
        paused = true;
      }
    }
  };
  const workers = Math.min(concurrency, RUNNER_CONFIG.concurrency, jobs.length);
  await Promise.all(Array.from({length: workers}, worker));
  return results;
}

/// <reference types="bun" />
import {afterEach, expect, spyOn, test} from 'bun:test';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {APICallError} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import type {Project} from '../sandbox/project';
import {SYSTEM_PROMPT_HASH} from './run';
import {evalCredential, parseTasks, previewScreenshot, runTasks, type Task} from './runner';
import {tempProject, textStep, toolStep} from './test-project';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(c => c());
  spyOn(console, 'error').mockRestore();
});

function outDir() {
  const dir = mkdtempSync(join(tmpdir(), 'betterlook-runs-'));
  cleanups.push(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}

const editingModel = () =>
  new MockLanguageModelV4({
    doStream: [toolStep([['e1', 'edit_file', {path: 'src/App.tsx', oldString: 'Hi', newString: 'Hello'}]]), textStep('Done.')],
  });

// A run holds a sandbox from creation until it is stopped.
const USAGE = {vcpus: 2, activeCpuMs: 1500, durationMs: 90_000};
function projects() {
  let inFlight = 0;
  let maxInFlight = 0;
  let stops = 0;
  return {
    stats: () => ({maxInFlight, inFlight, stops}),
    project: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'}, cmd => (cmd === 'node' ? {exitCode: 0, output: '[]'} : {exitCode: 0, output: ''}));
      cleanups.push(t.cleanup);
      return {...t.project, stop: async () => (inFlight--, stops++, USAGE)};
    },
    capture: async (_project: Project) => {
      await new Promise(r => setTimeout(r, 5));
      return new Uint8Array([137, 80, 78, 71]);
    },
  };
}

test('task files are a JSON array of {id, prompt} and extra fields pass through untouched', () => {
  const tasks = parseTasks([{id: 'a', prompt: 'p', judge: {anything: [1, 2]}}, {id: 'b.2', prompt: 'q'}]);
  expect(tasks[0]).toEqual({id: 'a', prompt: 'p', judge: {anything: [1, 2]}});
  expect(() => parseTasks([])).toThrow('non-empty JSON array');
  expect(() => parseTasks({})).toThrow('non-empty JSON array');
  expect(() => parseTasks([{id: '../x', prompt: 'p'}])).toThrow('needs an id');
  expect(() => parseTasks([{id: 'a'}])).toThrow('needs a prompt');
  expect(() => parseTasks([{id: 'a', prompt: 'p'}, {id: 'a', prompt: 'q'}])).toThrow('used twice');
});

test('the runner only ever uses the eval key', () => {
  expect(evalCredential('openai', {OPENAI_EVAL_API_KEY: 'eval'})).toEqual({provider: 'openai', kind: 'api-key', apiKey: 'eval'});
  expect(() => evalCredential('openai', {OPENAI_API_KEY: 'someone-elses'})).toThrow('Set OPENAI_EVAL_API_KEY');
  expect(evalCredential('anthropic', {ANTHROPIC_EVAL_API_KEY: 'eval-a'})).toEqual({provider: 'anthropic', kind: 'api-key', apiKey: 'eval-a'});
  expect(() => evalCredential('anthropic', {ANTHROPIC_API_KEY: 'x', OPENAI_EVAL_API_KEY: 'y'})).toThrow('Set ANTHROPIC_EVAL_API_KEY');
});

test('k runs per task go through runAgent, stay under the concurrency cap and each leave a complete folder', async () => {
  const out = outDir();
  const tasks: Task[] = [
    {id: 'task-a', prompt: 'first plumbing prompt', extra: {kept: true}},
    {id: 'task-b', prompt: 'second plumbing prompt'},
  ];
  const p = projects();
  let modelCalls = 0;
  const results = await runTasks({
    tasks,
    runs: 2,
    concurrency: 2,
    outDir: out,
    model: () => (modelCalls++, editingModel()),
    project: p.project,
    capture: p.capture,
  });

  expect(results.map(r => `${r.taskId}#${r.run}:${r.status}`).sort()).toEqual(['task-a#1:passed', 'task-a#2:passed', 'task-b#1:passed', 'task-b#2:passed']);
  expect(modelCalls).toBe(4);
  expect(p.stats().maxInFlight).toBe(2);
  for (const r of results) {
    expect(readdirSync(r.dir).sort()).toEqual(['after.png', 'before.png', 'diff.patch', 'task.json', 'turn.json', 'verify.json']);
    const turn = JSON.parse(readFileSync(join(r.dir, 'turn.json'), 'utf8'));
    expect(turn).toMatchObject({status: 'passed', sandbox: USAGE, systemPromptHash: SYSTEM_PROMPT_HASH, prompt: tasks.find(t => t.id === r.taskId)!.prompt});
    expect(turn.checkpoint.id).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(join(r.dir, 'diff.patch'), 'utf8')).toContain('+<h1>Hello</h1>');
    expect(JSON.parse(readFileSync(join(r.dir, 'verify.json'), 'utf8'))).toMatchObject({verify: {ok: true}, repairAttempted: false});
  }
  expect(JSON.parse(readFileSync(join(out, 'task-a/run-1/task.json'), 'utf8'))).toEqual(tasks[0]);
});

test('with a cap of 1, runs never overlap', async () => {
  const p = projects();
  const results = await runTasks({tasks: [{id: 'a', prompt: 'p'}], runs: 3, concurrency: 1, outDir: outDir(), model: editingModel, project: p.project, capture: p.capture});
  expect(results.map(r => r.run)).toEqual([1, 2, 3]);
  expect(p.stats().maxInFlight).toBe(1);
});

test('agent:run never holds more than 3 sandboxes, whatever concurrency is asked for, and stops each one', async () => {
  const p = projects();
  const results = await runTasks({tasks: [{id: 'a', prompt: 'p'}, {id: 'b', prompt: 'q'}], runs: 4, concurrency: 10, outDir: outDir(), model: editingModel, project: p.project, capture: p.capture});
  expect(results).toHaveLength(8);
  expect(p.stats()).toEqual({maxInFlight: 3, inFlight: 0, stops: 8});
});

test('a rate-limited run backs off and retries on a fresh sandbox', async () => {
  spyOn(console, 'error').mockImplementation(() => {});
  const p = projects();
  const waits: number[] = [];
  const logs: string[] = [];
  let calls = 0;
  const limited = () =>
    new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({message: 'Rate limit reached', url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode: 429, isRetryable: false});
      },
    });
  let projectsMade = 0;
  const [result] = await runTasks({
    tasks: [{id: 'only', prompt: 'p'}],
    runs: 1,
    concurrency: 1,
    outDir: outDir(),
    model: () => (++calls === 1 ? limited() : editingModel()),
    project: async () => (projectsMade++, p.project()),
    capture: p.capture,
    sleep: async ms => void waits.push(ms),
    log: line => void logs.push(line),
  });
  expect(result).toMatchObject({status: 'passed', attempts: 2});
  expect(waits).toEqual([5_000]);
  expect(projectsMade).toBe(2);
  expect(p.stats().stops).toBe(2);
  expect(logs).toEqual(['only run 1: rate limited, retrying in 5s', `only run 1: passed, sandbox ${JSON.stringify(USAGE)}`]);
});

test('the preview screenshot comes from the checker inside the sandbox and retries while the dev server starts', async () => {
  let tries = 0;
  const t = tempProject({}, (cmd, args) => (cmd === 'node' && args[2] === '/tmp/betterlook/preview.png' ? {exitCode: ++tries < 3 ? 1 : 0, output: ''} : undefined));
  cleanups.push(t.cleanup);
  const waits: number[] = [];
  t.project.readBytes = async path => (path === '/tmp/betterlook/preview.png' ? new Uint8Array([9]) : null);
  expect(await previewScreenshot(t.project, async ms => void waits.push(ms))).toEqual(new Uint8Array([9]));
  expect([tries, waits]).toEqual([3, [3_000, 3_000]]);
});

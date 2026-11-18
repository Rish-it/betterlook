/// <reference types="bun" />
import {afterEach, expect, test} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {relative} from 'node:path';
import {MockLanguageModelV4} from 'ai/test';
import {runTurn, tempProject, textStep, toolStep} from '../agent/test-project';
import type {Project} from '../sandbox/project';
import {HOOK_OUT, HOOK_PATH} from './collect';
import starterPage from './fixtures/starter-page.json';
import {CONFIG_HASH, LIVE_JOB, publishLive} from './turn';

const env = {...process.env};
afterEach(() => {
  process.env = {...env};
});

// A local project whose runtime check "collects" the real starter snapshot, standing in for the sandbox checker.
function liveProject() {
  const mem = new Map<string, string>();
  let root = '';
  const t = tempProject({'src/App.tsx': 'export const App = () => <h2>Why designers use it</h2>;\n', 'package.json': '{"dependencies":{"react":"19.3.1"}}'}, (cmd, args) => {
    if (cmd === 'node' && args[0].endsWith('check.mjs')) {
      if (args[3] === HOOK_PATH && mem.has(HOOK_PATH)) mem.set(HOOK_OUT, JSON.stringify({...starterPage, collectMs: 700}));
      return {exitCode: 0, output: '[]'};
    }
    if (cmd === 'node') return {exitCode: 0, output: execFileSync('node', args, {cwd: root}).toString()};
    if (cmd === 'realpath') return {exitCode: 0, output: args.slice(3).map(a => relative(root, a)).join('\n')};
    if (cmd === 'rm') return (args.slice(1).forEach(p => mem.delete(p)), {exitCode: 0, output: ''});
    return {exitCode: 0, output: ''};
  });
  root = t.root;
  const project: Project = {
    ...t.project,
    read: async p => (p.startsWith('/tmp/betterlook/') ? (mem.get(p) ?? null) : t.project.read(p)),
    write: async (p, c) => (p.startsWith('/tmp/betterlook/') ? void mem.set(p, c) : t.project.write(p, c)),
  };
  return {project, cleanup: t.cleanup};
}

const editModel = (message: string) =>
  new MockLanguageModelV4({
    doStream: [toolStep([['e1', 'edit_file', {path: 'src/App.tsx', oldString: 'Why designers use it', newString: 'What you get'}]]), textStep(message)],
  });

test('Trigger A scores the turn inside verify from the same browser session and measures the added time', async () => {
  const {project, cleanup} = liveProject();
  try {
    const {record} = await runTurn({model: editModel('I changed the heading to "What you get".'), messages: [{role: 'user', content: 'Change the heading.'}], project, evals: {job: LIVE_JOB, live: true}});
    expect(record.status).toBe('passed');
    expect(record.evals!.error).toBeUndefined();
    expect(Object.fromEntries(record.evals!.results.map(r => [r.eval, r.outcome]))).toEqual({
      E1: 'NOT_APPLICABLE',
      E2: 'PASS',
      E3: 'PASS',
      E4: 'PASS',
      E5: 'PASS',
      E6: 'PASS',
      E7: 'NOT_EVALUATED',
      E8: 'NOT_APPLICABLE',
    });
    expect(record.evals!.results.find(r => r.eval === 'E7')!.subrules![0]).toMatchObject({check: 'pre-check', outcome: 'PASS'});
    expect(record.evals!.addedVerifyMs).toBeGreaterThanOrEqual(700);
  } finally {
    cleanup();
  }
});

test('Trigger A catches a success claim over an empty diff on a no-change turn', async () => {
  const {project, cleanup} = liveProject();
  try {
    const model = new MockLanguageModelV4({doStream: [textStep('Done, the heading is updated.')]});
    const {record} = await runTurn({model, messages: [{role: 'user', content: 'Change the heading.'}], project, evals: {job: LIVE_JOB, live: true}});
    expect(record.status).toBe('no-changes');
    expect(record.evals!.results.find(r => r.eval === 'E7')!.subrules![0]).toMatchObject({outcome: 'FAIL'});
    expect(record.evals!.results.find(r => r.eval === 'E3')!.outcome).toBe('NOT_EVALUATED');
  } finally {
    cleanup();
  }
});

test('live scores go to the turn trace as BOOLEAN + outcome scores; a sampled judge adds a full E7 with same_family', async () => {
  const {project, cleanup} = liveProject();
  const posted: {url: string; body: {name: string; dataType: string; value: unknown; traceId: string; metadata: Record<string, unknown>}[]}[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    posted.push({url, body: JSON.parse(init.body as string)});
    return new Response('{"message":"Accepted"}', {status: 202});
  }) as typeof fetch;
  Object.assign(process.env, {LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test', LANGFUSE_BASE_URL: 'https://langfuse.invalid'});
  try {
    const {record} = await runTurn({model: editModel('I changed the heading.'), messages: [{role: 'user', content: 'Change the heading.'}], project, evals: {job: LIVE_JOB, live: true}});
    const judgeModel = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{type: 'text', text: '{"verdict":"PASS","reason":"Matches the diff."}'}],
        finishReason: {unified: 'stop', raw: undefined},
        usage: {inputTokens: {total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined}, outputTokens: {total: 1, text: 1, reasoning: undefined}},
        warnings: [],
      }),
    });
    const result = await publishLive(record, {random: () => 0.01, judge: {provider: 'openai', modelId: 'gpt-5.5', model: judgeModel}});
    expect(result.judged).toBe(true);
    const bodies = posted.flatMap(p => p.body);
    expect(posted.every(p => p.url === 'https://langfuse.invalid/api/public/scores')).toBe(true);
    expect(bodies.every(b => b.traceId === record.traceId)).toBe(true);
    expect(bodies.find(b => b.name === 'E4' && b.dataType === 'BOOLEAN')!.value).toBe(1);
    expect(bodies.find(b => b.name === 'E1 outcome')!.value).toBe('NOT_APPLICABLE');
    expect(bodies.some(b => b.name === 'E1' && b.dataType === 'BOOLEAN')).toBe(false);
    expect(bodies.find(b => b.name === 'E7 pre-check' && b.dataType === 'BOOLEAN')!.value).toBe(1);
    const e7 = bodies.filter(b => b.name === 'E7');
    expect(e7).toHaveLength(1);
    expect(e7[0].metadata).toMatchObject({same_family: false, config_hash: CONFIG_HASH, task_id: 'live'});
    expect(await publishLive(record, {random: () => 0.5})).toMatchObject({judged: false});
  } finally {
    globalThis.fetch = realFetch;
    cleanup();
  }
});

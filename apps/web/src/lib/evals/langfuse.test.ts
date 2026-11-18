/// <reference types="bun" />
import {afterEach, expect, test} from 'bun:test';
import {E7_HUMAN_SCORE, E7_QUEUE, ensureAnnotationQueue, scoreBodies} from './langfuse';

const env = {...process.env};
const realFetch = globalThis.fetch;
afterEach(() => {
  process.env = {...env};
  globalThis.fetch = realFetch;
});

function fakeLangfuse(existing: {configs: {id: string; name: string}[]; queues: {id: string; name: string}[]}) {
  Object.assign(process.env, {LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test', LANGFUSE_BASE_URL: 'https://langfuse.invalid'});
  const calls: {method: string; path: string; body: unknown}[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://langfuse.invalid', '');
    calls.push({method: init.method!, path, body: init.body ? JSON.parse(init.body as string) : null});
    const json = path.startsWith('/api/public/score-configs?') ? {data: existing.configs} : path.startsWith('/api/public/annotation-queues?') ? {data: existing.queues} : {id: init.method === 'POST' && path === '/api/public/score-configs' ? 'cfg-new' : 'queue-new'};
    return new Response(JSON.stringify(json), {status: 200});
  }) as typeof fetch;
  return calls;
}

test('creates the E7 calibration queue with a PASS/FAIL score config when neither exists', async () => {
  const calls = fakeLangfuse({configs: [], queues: []});
  expect(await ensureAnnotationQueue()).toEqual({queueId: 'queue-new', scoreConfigId: 'cfg-new'});
  const posts = calls.filter(c => c.method === 'POST');
  expect(posts[0]).toMatchObject({path: '/api/public/score-configs', body: {name: E7_HUMAN_SCORE, dataType: 'CATEGORICAL', categories: [{label: 'PASS', value: 1}, {label: 'FAIL', value: 0}]}});
  expect(posts[1]).toMatchObject({path: '/api/public/annotation-queues', body: {name: 'E7 honesty — 20-run calibration', scoreConfigIds: ['cfg-new']}});
});

test('reuses an existing queue and score config instead of duplicating them', async () => {
  const calls = fakeLangfuse({configs: [{id: 'cfg-1', name: E7_HUMAN_SCORE}], queues: [{id: 'q-1', name: E7_QUEUE}]});
  expect(await ensureAnnotationQueue()).toEqual({queueId: 'q-1', scoreConfigId: 'cfg-1'});
  expect(calls.filter(c => c.method === 'POST')).toEqual([]);
});

test('score bodies: BOOLEAN only for PASS/FAIL, an outcome score for every result, stable ids', () => {
  const meta = {task_id: 't', run_id: 'r', model_id: 'm', config_hash: 'c', evidence_ref: 'e', timestamp: 'now', eval_id: 'E1' as const, check: 'E1', evaluator_version: 'v', outcome: 'PASS' as const};
  const bodies = scoreBodies('trace-1', [
    {name: 'E1', outcome: 'PASS', value: 1, comment: 'ok', metadata: meta},
    {name: 'E8', outcome: 'NOT_APPLICABLE', value: null, comment: 'n/a', metadata: {...meta, eval_id: 'E8', outcome: 'NOT_APPLICABLE'}},
  ]);
  expect(bodies.map(b => `${b.name}:${b.dataType}:${b.value}`)).toEqual(['E1:BOOLEAN:1', 'E1 outcome:CATEGORICAL:PASS', 'E8 outcome:CATEGORICAL:NOT_APPLICABLE']);
  expect(scoreBodies('trace-1', [{name: 'E1', outcome: 'PASS', value: 1, comment: 'ok', metadata: meta}])[0].id).toBe(bodies[0].id);
});

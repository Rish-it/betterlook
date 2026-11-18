/// <reference types="bun" />
import {afterEach, beforeEach, expect, spyOn, test} from 'bun:test';
import {APICallError} from 'ai';
import {convertArrayToReadableStream, MockLanguageModelV4} from 'ai/test';
import {POST as chatPOST} from '@/app/api/chat/route';
import {AGENT_CONFIG} from './config';
import {PROVIDER_FAILED, RATE_LIMITED, REFUSED, SANDBOX_FAILED, STEP_LIMIT, VERIFY_FAILED} from './errors';
import {runTurn, tempProject, textStep, toolStep} from './test-project';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  spyOn(console, 'error').mockImplementation(() => {});
  spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanups.splice(0).forEach(c => c());
  spyOn(console, 'error').mockRestore();
  spyOn(console, 'warn').mockRestore();
});

function project(scripted?: Parameters<typeof tempProject>[1]) {
  const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'}, scripted ?? (cmd => (cmd === 'node' ? {exitCode: 0, output: '[]'} : {exitCode: 0, output: ''})));
  cleanups.push(t.cleanup);
  return t;
}

const failing = (statusCode: number) =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({message: 'provider says no', url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode, isRetryable: false});
    },
  });

const ask = (text = 'make it blue') => [{role: 'user' as const, content: text}];

async function expectChatStillWorks(p = project().project) {
  const {record, message} = await runTurn({model: new MockLanguageModelV4({doStream: [textStep('Still here.')]}), messages: ask('hello again'), project: p});
  expect(record.status).toBe('passed');
  expect(message.parts.find(part => part.type === 'text')).toMatchObject({text: 'Still here.'});
}

test('rate limit: a readable message, a finished stream, and the next turn works', async () => {
  const {chunks, message, record} = await runTurn({model: failing(429), messages: ask(), project: project().project});
  expect(chunks).toContainEqual({type: 'error', errorText: RATE_LIMITED});
  expect(chunks.at(-1)?.type).toBe('finish');
  expect(record).toMatchObject({status: 'error', error: RATE_LIMITED});
  expect(message.metadata).toMatchObject({status: 'error', notice: RATE_LIMITED});
  await expectChatStillWorks();
});

test('provider error: a readable message without the provider text', async () => {
  const {chunks, message} = await runTurn({model: failing(500), messages: ask(), project: project().project});
  expect(chunks).toContainEqual({type: 'error', errorText: PROVIDER_FAILED});
  expect(JSON.stringify(chunks)).not.toContain('provider says no');
  expect(message.metadata).toMatchObject({status: 'error', notice: PROVIDER_FAILED});
  await expectChatStillWorks();
});

test('refusal: a readable notice, no checkpoint or verify, and the next turn works', async () => {
  const refusal = {
    stream: convertArrayToReadableStream([
      {type: 'finish' as const, finishReason: {unified: 'content-filter' as const, raw: 'refusal'}, usage: {inputTokens: {total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined}, outputTokens: {total: 0, text: 0, reasoning: undefined}}},
    ]),
  };
  const {chunks, message, record} = await runTurn({model: new MockLanguageModelV4({doStream: [refusal]}), messages: ask(), project: project().project});
  expect(record).toMatchObject({status: 'error', error: REFUSED, checkpoint: null, verify: null});
  expect(chunks.some(c => c.type === 'data-verify' || c.type === 'data-checkpoint')).toBe(false);
  expect(chunks.at(-1)?.type).toBe('finish');
  expect(message.metadata).toMatchObject({status: 'error', notice: REFUSED});
  await expectChatStillWorks();
});

test('sandbox down mid-turn: a readable message and a finished stream', async () => {
  const t = project();
  const broken = {...t.project, run: async () => ({exitCode: 128, output: 'fatal: sandbox gone'})};
  const model = new MockLanguageModelV4({doStream: [toolStep([['e1', 'edit_file', {path: 'src/App.tsx', oldString: 'Hi', newString: 'Hello'}]]), textStep('Done.')]});
  const {chunks, message, record} = await runTurn({model, messages: ask(), project: broken});
  expect(chunks).toContainEqual({type: 'error', errorText: SANDBOX_FAILED});
  expect(chunks.at(-1)?.type).toBe('finish');
  expect(record).toMatchObject({status: 'error', error: SANDBOX_FAILED});
  expect(message.metadata).toMatchObject({status: 'error', notice: SANDBOX_FAILED});
  await expectChatStillWorks();
});

test('sandbox down before the turn: /api/chat answers with a readable 503', async () => {
  const saved = {...process.env};
  Object.assign(process.env, {VERCEL_TOKEN: 'fake-token', VERCEL_TEAM_ID: 'team_x', VERCEL_PROJECT_ID: 'prj_x'});
  try {
    const res = await chatPOST(
      new Request('http://x/api/chat', {
        method: 'POST',
        body: JSON.stringify({messages: [], model: 'gpt-5', credential: {provider: 'openai', kind: 'api-key', apiKey: 'k'}, sandboxId: 'gone'}),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('The preview sandbox is not reachable. Reload to try again.');
  } finally {
    process.env = saved;
  }
});

test('denied tool: the data part carries a readable reason and the turn carries on', async () => {
  const model = new MockLanguageModelV4({doStream: [toolStep([['d1', 'read_file', {path: '/etc/passwd'}]]), textStep('I cannot read files outside the project.')]});
  const {message, record} = await runTurn({model, messages: ask('read /etc/passwd'), project: project().project});
  expect(message.parts.find(p => p.type === 'data-denied')).toMatchObject({data: {message: '/etc/passwd is outside the project folder.'}});
  expect(record.status).toBe('passed');
  await expectChatStillWorks();
});

test('failed verify: status failed with a readable notice and restore offered via the checkpoint', async () => {
  const t = project((cmd, args) => (args.includes('typecheck') ? {exitCode: 2, output: 'error TS2322'} : cmd === 'node' ? {exitCode: 0, output: '[]'} : {exitCode: 0, output: ''}));
  const model = new MockLanguageModelV4({doStream: [textStep('Done.'), textStep('Still broken.')]});
  const {message, record} = await runTurn({model, messages: ask(), project: t.project});
  expect(record.status).toBe('failed');
  expect(message.metadata).toMatchObject({status: 'failed', notice: VERIFY_FAILED});
  expect(message.parts.find(p => p.type === 'data-checkpoint')).toMatchObject({data: {parentId: expect.stringMatching(/^[0-9a-f]{40}$/)}});
  await expectChatStillWorks();
});

test('step limit: the turn says it stopped early and how to continue', async () => {
  let n = 0;
  const model = new MockLanguageModelV4({doStream: async () => toolStep([[`l${n++}`, 'list_files', {}]])});
  const {message, record} = await runTurn({model, messages: ask('keep looking'), project: project().project});
  expect(model.doStreamCalls.length).toBe(AGENT_CONFIG.maxSteps);
  expect(record).toMatchObject({stepLimitReached: true, status: 'passed'});
  expect(message.metadata).toMatchObject({notice: STEP_LIMIT});
  await expectChatStillWorks();
});

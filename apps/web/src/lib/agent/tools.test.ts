/// <reference types="bun" />
import {afterEach, beforeEach, expect, spyOn, test} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {simulateReadableStream, type ModelMessage} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import type {Project} from '../sandbox/project';
import {checkPolicy} from './policy';
import {runAgent, type AgentChunk} from './run';
import {applyEdit} from './tools';

const ROOT = '/vercel/sandbox';
let dir: string;

const localProject = (root: string): Project => ({
  id: 'sbx-local',
  root,
  list: async d => execFileSync('find', [d, '-type', 'f', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*']).toString().split('\n').filter(Boolean).map(p => relative(root, p)),
  read: async p => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: async (p, c) => { mkdirSync(dirname(p), {recursive: true}); writeFileSync(p, c); },
  search: async (q, d) => { try { return execFileSync('grep', ['-rnI', '-e', q, d]).toString().replaceAll(`${root}/`, ''); } catch { return ''; } },
  run: async () => ({exitCode: 0, output: ''}),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'betterlook-tools-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/App.tsx'), '<h1 className="hero-heading">Hi</h1>\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"starter"}\n');
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
  spyOn(console, 'warn').mockRestore();
});

const usage = {
  inputTokens: {total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined},
  outputTokens: {total: 1, text: 1, reasoning: undefined},
};
const toolStep = (calls: [string, string, object][]) => ({
  stream: simulateReadableStream({
    chunks: [
      ...calls.map(([toolCallId, toolName, input]) => ({type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input)})),
      {type: 'finish' as const, finishReason: {unified: 'tool-calls' as const, raw: undefined}, logprobs: undefined, usage},
    ],
  }),
});
const textStep = (text: string) => ({
  stream: simulateReadableStream({
    chunks: [
      {type: 'text-start' as const, id: 't'},
      {type: 'text-delta' as const, id: 't', delta: text},
      {type: 'text-end' as const, id: 't'},
      {type: 'finish' as const, finishReason: {unified: 'stop' as const, raw: undefined}, logprobs: undefined, usage},
    ],
  }),
});

test('the path policy keeps tools inside the project and asks before protected edits', () => {
  expect(checkPolicy('read_file', {path: 'src/App.tsx'}, ROOT)).toEqual({type: 'allow', path: 'src/App.tsx'});
  expect(checkPolicy('read_file', {path: `${ROOT}/src/App.tsx`}, ROOT)).toEqual({type: 'allow', path: 'src/App.tsx'});
  expect(checkPolicy('list_files', {path: '.'}, ROOT)).toEqual({type: 'allow', path: ''});
  for (const path of ['../secrets', '/etc/passwd', 'src/../../x', `${ROOT}-other/a`]) {
    expect(checkPolicy('read_file', {path}, ROOT)).toMatchObject({type: 'deny', reason: 'outside-project'});
  }
  expect(checkPolicy('read_file', {path: '.git/config'}, ROOT)).toMatchObject({type: 'deny'});
  expect(checkPolicy('write_file', {path: 'node_modules/react/index.js'}, ROOT)).toMatchObject({type: 'deny'});
  for (const path of ['package.json', 'bun.lock', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', '.env.local', 'apps/x/package.json']) {
    expect(checkPolicy('write_file', {path}, ROOT)).toMatchObject({type: 'approve'});
    expect(checkPolicy('edit_file', {path}, ROOT)).toMatchObject({type: 'approve'});
  }
  expect(checkPolicy('read_file', {path: 'package.json'}, ROOT)).toEqual({type: 'allow', path: 'package.json'});
  expect(checkPolicy('run_shell', {cmd: 'rm -rf /'}, ROOT)).toMatchObject({type: 'deny', reason: 'not-allowlisted'});
  expect(checkPolicy('typecheck', {}, ROOT)).toEqual({type: 'allow'});
});

test('edit_file replaces exactly one occurrence', () => {
  expect(applyEdit('a b c', 'b', 'B')).toBe('a B c');
  expect(applyEdit('cost $1', '$1', '$&2')).toBe('cost $&2');
  expect(() => applyEdit('a b c', 'x', 'y')).toThrow('not found');
  expect(() => applyEdit('b b', 'b', 'y')).toThrow('matches 2 places');
});

test('allowed tools run in the project; a call outside it is denied, logged, recorded and returned to the model', async () => {
  const warned: unknown[][] = [];
  spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args));
  const model = new MockLanguageModelV4({
    doStream: [
      toolStep([
        ['c1', 'list_files', {}],
        ['c2', 'search', {query: 'hero-heading'}],
        ['c3', 'edit_file', {path: 'src/App.tsx', oldString: 'className="hero-heading"', newString: 'className="hero-heading" style={{color: "blue"}}'}],
        ['c4', 'read_file', {path: '../../etc/passwd'}],
      ]),
      textStep('Done.'),
    ],
  });
  const chunks: AgentChunk[] = [];
  const {result, turn} = runAgent({model, messages: [{role: 'user', content: 'make it blue'}], project: localProject(dir), onData: c => chunks.push(c)});
  await result.consumeStream();
  const record = await turn;

  expect(readFileSync(join(dir, 'src/App.tsx'), 'utf8')).toContain('style={{color: "blue"}}');
  expect(record.sandboxId).toBe('sbx-local');
  expect(record.toolCalls.map(c => [c.id, c.decision])).toEqual([
    ['c4', 'denied'],
    ['c1', 'allowed'],
    ['c2', 'allowed'],
    ['c3', 'allowed'],
  ]);
  expect(record.toolCalls.find(c => c.id === 'c1')?.result).toBe('package.json\nsrc/App.tsx');
  expect(record.toolCalls.find(c => c.id === 'c2')?.result).toContain('src/App.tsx:1:');
  expect(record.toolCalls.every(c => typeof c.durationMs === 'number' && c.startedAt)).toBe(true);
  expect(record.toolCalls[0].denied).toMatchObject({toolCallId: 'c4', reason: 'outside-project', message: '../../etc/passwd is outside the project folder.'});
  expect(chunks).toEqual([{type: 'data-denied', id: 'c4', data: record.toolCalls[0].denied!}]);
  expect(warned).toEqual([['[policy] denied:', 'read_file', 'outside-project']]);

  const secondPrompt = JSON.stringify(model.doStreamCalls[1].prompt);
  expect(secondPrompt).toContain('../../etc/passwd is outside the project folder.');
  expect(secondPrompt).toContain('Edited src/App.tsx.');
  expect(model.doStreamCalls[0].providerOptions).toEqual({openai: {store: false, promptCacheKey: 'sbx-local'}});
});

test('a package.json edit pauses for approval, then runs once approved', async () => {
  const project = localProject(dir);
  const chunks: AgentChunk[] = [];
  const first = runAgent({
    model: new MockLanguageModelV4({doStream: [toolStep([['p1', 'write_file', {path: 'package.json', content: '{"name":"changed"}\n'}]])]}),
    messages: [{role: 'user', content: 'rename the package'}],
    project,
    onData: c => chunks.push(c),
  });
  await first.result.consumeStream();
  const paused = await first.turn;

  expect(paused.status).toBe('awaiting-approval');
  expect(paused.toolCalls).toEqual([]);
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{"name":"starter"}\n');
  expect(chunks).toEqual([
    {type: 'data-approval', id: 'p1', data: {toolCallId: 'p1', tool: 'write_file', path: 'package.json', diff: '--- a/package.json\n+++ b/package.json\n-{"name":"starter"}\n-\n+{"name":"changed"}\n+'}},
  ]);
  const request = (await first.result.content).find(p => p.type === 'tool-approval-request');
  expect(request).toBeDefined();

  const messages: ModelMessage[] = [
    {role: 'user', content: 'rename the package'},
    ...(await first.result.response).messages,
    {role: 'tool', content: [{type: 'tool-approval-response', approvalId: request!.approvalId, approved: true}]},
  ];
  const second = runAgent({model: new MockLanguageModelV4({doStream: [textStep('Renamed.')]}), messages, project});
  await second.result.consumeStream();
  const resumed = await second.turn;

  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{"name":"changed"}\n');
  expect(resumed.toolCalls.map(c => [c.id, c.decision])).toEqual([['p1', 'approved']]);
  expect(resumed.status).toBe('passed');
});

test('a denied approval leaves the file alone and tells the model', async () => {
  const project = localProject(dir);
  const first = runAgent({
    model: new MockLanguageModelV4({doStream: [toolStep([['p2', 'edit_file', {path: 'package.json', oldString: 'starter', newString: 'x'}]])]}),
    messages: [{role: 'user', content: 'rename'}],
    project,
  });
  await first.result.consumeStream();
  const request = (await first.result.content).find(p => p.type === 'tool-approval-request')!;
  const model = new MockLanguageModelV4({doStream: [textStep('Okay, left it.')]});
  const second = runAgent({
    model,
    messages: [
      {role: 'user', content: 'rename'},
      ...(await first.result.response).messages,
      {role: 'tool', content: [{type: 'tool-approval-response', approvalId: request.approvalId, approved: false, reason: 'User denied the edit.'}]},
    ],
    project,
  });
  await second.result.consumeStream();
  expect((await second.turn).toolCalls).toEqual([]);
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{"name":"starter"}\n');
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain('User denied the edit.');
});

test('the chat stream carries the denied and approval data parts next to the tool parts', async () => {
  const {agentUIStream} = await import('./run');
  const stream = agentUIStream({
    model: new MockLanguageModelV4({
      doStream: [toolStep([['d1', 'read_file', {path: '/etc/hosts'}], ['a1', 'edit_file', {path: 'package.json', oldString: 'starter', newString: 'x'}]])],
    }),
    messages: [{role: 'user', content: 'go'}],
    project: localProject(dir),
  });
  const types: string[] = [];
  for await (const chunk of stream) types.push(chunk.type);
  expect(types).toContain('data-denied');
  expect(types).toContain('data-approval');
  expect(types).toContain('tool-output-denied');
  expect(types).toContain('tool-approval-request');
});

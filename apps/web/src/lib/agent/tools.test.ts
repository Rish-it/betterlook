/// <reference types="bun" />
import {afterEach, expect, spyOn, test} from 'bun:test';
import {convertToModelMessages} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {checkPolicy} from './policy';
import {runTurn, tempProject, textStep, toolStep} from './test-project';
import {applyEdit} from './tools';
import type {AgentMessage} from './types';

const ROOT = '/vercel/sandbox';
const STARTER = {'src/App.tsx': '<h1 className="hero-heading">Hi</h1>\n', 'package.json': '{"name":"starter"}\n'};
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(c => c());
  spyOn(console, 'warn').mockRestore();
  spyOn(console, 'info').mockRestore();
});

function setup() {
  const t = tempProject(STARTER);
  cleanups.push(t.cleanup);
  return t;
}

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
  const {project, file} = setup();
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
  const {chunks, message, record} = await runTurn({model, messages: [{role: 'user', content: 'make it blue'}], project});

  expect(file('src/App.tsx')).toContain('style={{color: "blue"}}');
  expect(record.toolCalls.map(c => [c.id, c.decision])).toEqual([
    ['c4', 'denied'],
    ['c1', 'allowed'],
    ['c2', 'allowed'],
    ['c3', 'allowed'],
  ]);
  expect(record.toolCalls.find(c => c.id === 'c1')?.result).toBe('package.json\nsrc/App.tsx');
  expect(record.toolCalls.find(c => c.id === 'c2')?.result).toContain('src/App.tsx:1:');
  expect(record.toolCalls[0].denied).toMatchObject({toolCallId: 'c4', reason: 'outside-project', message: '../../etc/passwd is outside the project folder.'});
  expect(chunks.filter(c => c.type === 'data-denied')).toEqual([{type: 'data-denied', id: 'c4', data: record.toolCalls[0].denied!}]);
  expect(message.parts.map(p => p.type)).toContain('data-denied');
  expect(warned).toEqual([['[policy] denied:', 'read_file', 'outside-project']]);

  const secondPrompt = JSON.stringify(model.doStreamCalls[1].prompt);
  expect(secondPrompt).toContain('../../etc/passwd is outside the project folder.');
  expect(secondPrompt).toContain('Edited src/App.tsx.');
  expect(model.doStreamCalls[0].providerOptions).toEqual({openai: {store: false, promptCacheKey: 'sbx-local'}, anthropic: {fallbacks: 'default'}});
});

async function pauseThenAnswer(approved: boolean) {
  const infos: unknown[][] = [];
  spyOn(console, 'info').mockImplementation((...args: unknown[]) => void infos.push(args));
  const {project, file} = setup();
  const userMessage: AgentMessage = {id: 'u1', role: 'user', parts: [{type: 'text', text: 'rename the package'}]};
  const paused = await runTurn({
    model: new MockLanguageModelV4({doStream: [toolStep([['p1', 'write_file', {path: 'package.json', content: '{"name":"changed"}\n'}]])]}),
    messages: await convertToModelMessages([userMessage]),
    project,
  });
  const part = paused.message.parts.find(p => p.type === 'tool-write_file') as {state: string; approval: {id: string}};
  expect(part.state).toBe('approval-requested');
  Object.assign(part, {state: 'approval-responded', approval: {...part.approval, approved, reason: approved ? undefined : 'User denied the edit.'}});

  const model = new MockLanguageModelV4({doStream: [textStep(approved ? 'Renamed.' : 'Okay, left it.')]});
  const resumed = await runTurn({model, messages: await convertToModelMessages([userMessage, paused.message]), project});
  return {paused, resumed, model, file, infos};
}

test('a package.json edit pauses for approval with a diff, then runs once approved and logs the approval', async () => {
  const {paused, resumed, file, infos} = await pauseThenAnswer(true);
  expect(paused.record.status).toBe('awaiting-approval');
  expect(paused.record.toolCalls).toEqual([]);
  expect(paused.record.checkpoint).toBeNull();
  expect(paused.chunks.find(c => c.type === 'data-approval')).toEqual({
    type: 'data-approval',
    id: 'p1',
    data: {toolCallId: 'p1', tool: 'write_file', path: 'package.json', diff: '--- a/package.json\n+++ b/package.json\n-{"name":"starter"}\n-\n+{"name":"changed"}\n+'},
  });
  expect(file('package.json')).toBe('{"name":"changed"}\n');
  expect(resumed.record.toolCalls.map(c => [c.id, c.decision])).toEqual([['p1', 'approved']]);
  expect(resumed.record.status).toBe('passed');
  expect(resumed.record.filesTouched).toEqual(['package.json']);
  expect(infos.map(i => JSON.parse(i[1] as string))).toEqual([expect.objectContaining({type: 'approve', toolCallId: 'p1', turnId: resumed.record.id, traceId: resumed.record.traceId})]);
});

test('a denied approval leaves the file alone, tells the model and logs the denial', async () => {
  const {resumed, model, file, infos} = await pauseThenAnswer(false);
  expect(resumed.record.toolCalls).toEqual([]);
  expect(file('package.json')).toBe('{"name":"starter"}\n');
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain('User denied the edit.');
  expect(infos.map(i => JSON.parse(i[1] as string).type)).toEqual(['deny']);
});

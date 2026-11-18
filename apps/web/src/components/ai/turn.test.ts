import {expect, test} from 'bun:test';
import type {AgentMessage} from '@/lib/agent/types';
import {cancelReason, changedFiles, hasThought, startedBuilding, uniqueById, unshownApprovals} from './turn';

const approvalPart = {
  type: 'tool-write_file',
  toolCallId: 'call_pkg',
  state: 'approval-requested',
  input: {path: 'package.json', content: '{}'},
  approval: {id: 'approval_pkg'},
} as const;

const assistant = (parts: AgentMessage['parts']): AgentMessage => ({id: 'msg_a', role: 'assistant', parts});

test('an approval request with no card data is returned so it can be denied', () => {
  expect(unshownApprovals([assistant([approvalPart])])).toEqual(['approval_pkg']);
});

test('an approval request with card data, or already answered, is left alone', () => {
  const card = {type: 'data-approval', id: 'call_pkg', data: {toolCallId: 'call_pkg', tool: 'write_file', path: 'package.json', diff: ''}} as const;
  expect(unshownApprovals([assistant([card, approvalPart])])).toEqual([]);
  const answered = {...approvalPart, state: 'approval-responded', approval: {id: 'approval_pkg', approved: false}} as const;
  expect(unshownApprovals([assistant([answered])])).toEqual([]);
});

test('a message that arrives twice under one id renders once, as its latest copy', () => {
  const first = assistant([{type: 'text', text: 'old'}]);
  const user: AgentMessage = {id: 'msg_u', role: 'user', parts: [{type: 'text', text: 'hi'}]};
  const latest = {...first, parts: [{type: 'text' as const, text: 'new'}]};
  expect(uniqueById([user, first, latest])).toEqual([user, latest]);
});

test('only a turn whose diff is non-empty changed files', () => {
  expect(changedFiles(assistant([{type: 'data-diff', id: 'diff', data: {diff: 'diff --git a/x b/x', filesTouched: ['x']}}]))).toBe(true);
  expect(changedFiles(assistant([{type: 'data-diff', id: 'diff', data: {diff: '', filesTouched: []}}]))).toBe(false);
  expect(changedFiles(assistant([{type: 'text', text: 'No changes made.'}]))).toBe(false);
});

test('a reasoning part with no text has nothing to show', () => {
  expect(hasThought({type: 'reasoning', text: '', state: 'done'})).toBe(false);
  expect(hasThought({type: 'reasoning', text: ' \n', state: 'streaming'})).toBe(false);
  expect(hasThought({type: 'reasoning', text: 'Read Hero.tsx first.', state: 'done'})).toBe(true);
});

test('a cancelled call is told apart from a tool error by its reason', () => {
  const error = {type: 'tool-write_file', toolCallId: 'c1', state: 'output-error', input: undefined, errorText: 'Cancelled: the model ended its turn before this call ran.'} as const;
  expect(cancelReason(error)).toBe('Cancelled: the model ended its turn before this call ran.');
  expect(cancelReason({...error, errorText: 'oldText not found in src/App.tsx'})).toBeUndefined();
});

test('building starts at the first write or edit call, or a saved diff or checkpoint', () => {
  const user: AgentMessage = {id: 'msg_u', role: 'user', parts: [{type: 'text', text: 'Make the title bigger'}]};
  const read = {type: 'tool-read_file', toolCallId: 'c1', state: 'input-available', input: {path: 'src/App.tsx'}} as const;
  const edit = {type: 'tool-edit_file', toolCallId: 'c2', state: 'input-streaming', input: undefined} as const;
  const checkpoint = {type: 'data-checkpoint', id: 'cp', data: {id: 'cp1', parentId: 'cp0', sandboxId: 'sb', turnId: 't1', createdAt: ''}} as const;
  expect(startedBuilding([])).toBe(false);
  expect(startedBuilding([user, assistant([{type: 'text', text: 'Looking.'}, read])])).toBe(false);
  expect(startedBuilding([user, assistant([read, edit])])).toBe(true);
  expect(startedBuilding([user, assistant([approvalPart])])).toBe(true);
  expect(startedBuilding([user, assistant([checkpoint])])).toBe(true);
  expect(startedBuilding([user, assistant([{type: 'data-diff', id: 'diff', data: {diff: 'diff --git a/x b/x', filesTouched: ['x']}}])])).toBe(true);
});

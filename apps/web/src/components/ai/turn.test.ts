import {expect, test} from 'bun:test';
import type {AgentMessage} from '@/lib/agent/types';
import {uniqueById, unshownApprovals} from './turn';

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

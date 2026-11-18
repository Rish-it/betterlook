/// <reference types="bun" />
import {afterEach, expect, test} from 'bun:test';
import {createAgentChat, keyNotice, retry} from './client';
import type {AgentMessage, ProviderCredential, ProviderId} from './types';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const noKey = () => null;
const withKey = (provider: ProviderId): ProviderCredential => ({provider, kind: 'api-key', apiKey: 'test-key'});
const session = (body: object) => {
  globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch;
};

test('a model whose provider has no key is held with a notice naming the provider', async () => {
  expect(await keyNotice('claude-sonnet-5-5', noKey)).toBe('Add an Anthropic key to send');
  session({status: 'signed-out', available: true});
  expect(await keyNotice('gpt-5', noKey)).toBe('Add an OpenAI key to send');
});

test('a key, or a ChatGPT sign-in for OpenAI, lets the send go', async () => {
  expect(await keyNotice('claude-sonnet-5-5', withKey)).toBeUndefined();
  expect(await keyNotice('gpt-5', withKey)).toBeUndefined();
  session({status: 'signed-in', account: 'a', planEnabled: true});
  expect(await keyNotice('gpt-5', noKey)).toBeUndefined();
});

test('a retry resends the failed user message under its own id, never a second copy', async () => {
  const bodies: {messages: AgentMessage[]; model: string; trigger: string}[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response('The model provider returned an error. Try again.', {status: 500});
  }) as unknown as typeof fetch;
  const chat = createAgentChat({getCredential: withKey, getSandboxId: () => null});
  await chat.sendMessage({text: 'Design a landing page', metadata: {model: 'claude-sonnet-5-5'}}, {body: {model: 'claude-sonnet-5-5'}});
  expect(chat.status).toBe('error');

  expect(await retry(chat, withKey)).toBeUndefined();
  while (chat.status !== 'error' || bodies.length < 2) await Bun.sleep(1);
  const userIds = chat.messages.filter(m => m.role === 'user').map(m => m.id);
  expect(userIds).toHaveLength(1);
  expect(bodies[1]).toMatchObject({model: 'claude-sonnet-5-5', trigger: 'regenerate-message'});
  expect(bodies[1].messages.map(m => m.id)).toEqual(userIds);
});

test('a retry without a key is held and sends nothing', async () => {
  const chat = createAgentChat({getCredential: noKey, getSandboxId: () => null, messages: [{id: 'u1', role: 'user', metadata: {model: 'claude-sonnet-5-5'}, parts: [{type: 'text', text: 'hi'}]}]});
  expect(await retry(chat, noKey)).toBe('Add an Anthropic key to send');
  expect(chat.status).toBe('ready');
});

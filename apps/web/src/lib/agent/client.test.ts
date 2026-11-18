/// <reference types="bun" />
import {afterEach, expect, test} from 'bun:test';
import {keyNotice} from './client';
import type {ProviderCredential, ProviderId} from './types';

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

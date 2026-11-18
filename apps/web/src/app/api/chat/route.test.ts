/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {POST} from './route';

const post = (credential: unknown, model = 'gpt-5') =>
  POST(new Request('http://x/api/chat', {method: 'POST', body: JSON.stringify({messages: [], model, credential})}));
const OPENAI_MISSING = 'Sign in or add an OpenAI API key to use GPT-5.';

test('an OAuth token in the request body is rejected like a missing key', async () => {
  const res = await post({provider: 'openai', kind: 'oauth', accessToken: 'body-token-not-allowed'});
  expect(res.status).toBe(401);
  expect(await res.text()).toBe(OPENAI_MISSING);
});

test('a request with no credential and no session gets the same message', async () => {
  const res = await post(null);
  expect(res.status).toBe(401);
  expect(await res.text()).toBe(OPENAI_MISSING);
});

test('a Claude model with only an OpenAI key asks for an Anthropic key', async () => {
  const res = await post({provider: 'openai', kind: 'api-key', apiKey: 'fake-openai-key'}, 'claude-sonnet-5-5');
  expect(res.status).toBe(401);
  expect(await res.text()).toBe('Add an Anthropic API key to use Claude Sonnet 5.5.');
});

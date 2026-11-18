/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {POST} from './route';

const post = (credential: unknown) =>
  POST(new Request('http://x/api/chat', {method: 'POST', body: JSON.stringify({messages: [], model: 'gpt-5', credential})}));

test('an OAuth token in the request body is rejected like a missing key', async () => {
  const res = await post({provider: 'openai', kind: 'oauth', accessToken: 'body-token-not-allowed'});
  expect(res.status).toBe(401);
  expect(await res.text()).toBe('Sign in or add an API key to start.');
});

test('a request with no credential and no session gets the same message', async () => {
  const res = await post(null);
  expect(res.status).toBe(401);
  expect(await res.text()).toBe('Sign in or add an API key to start.');
});

/// <reference types="bun" />
import {afterEach, expect, spyOn, test} from 'bun:test';
import {APICallError} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {KEY_REJECTED, missingKey, PROVIDER_FAILED, RATE_LIMITED, userMessage} from './errors';
import {runTurn} from './test-project';

const FAKE_KEY_ECHO = 'Incorrect API key provided: fake-***-4321';
const apiError = (statusCode: number) =>
  new APICallError({message: FAKE_KEY_ECHO, url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode, responseBody: FAKE_KEY_ECHO});

afterEach(() => spyOn(console, 'error').mockRestore());

test('maps provider errors to fixed user messages', () => {
  expect(userMessage(apiError(401))).toBe(KEY_REJECTED);
  expect(userMessage(apiError(403))).toBe(KEY_REJECTED);
  expect(userMessage(apiError(429))).toBe(RATE_LIMITED);
  expect(userMessage(apiError(500))).toBe(PROVIDER_FAILED);
  expect(userMessage(apiError(529))).toBe(PROVIDER_FAILED);
  expect(userMessage(new Error(FAKE_KEY_ECHO))).toBe(PROVIDER_FAILED);
});

test('the missing-key message names the provider the model needs', () => {
  expect(missingKey({provider: 'anthropic', label: 'Claude Sonnet 5.5'})).toBe('Add an Anthropic API key to use Claude Sonnet 5.5.');
  expect(missingKey({provider: 'openai', label: 'GPT-5'})).toBe('Sign in or add an OpenAI API key to use GPT-5.');
});

test('a rejected key reaches the chat as a clear message and never leaks provider text', async () => {
  const logged: unknown[][] = [];
  spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args));
  const model = new MockLanguageModelV4({doStream: async () => { throw apiError(401); }});
  const {chunks, record} = await runTurn({model, messages: [{role: 'user', content: 'hi'}]});
  expect(record).toMatchObject({status: 'error', error: KEY_REJECTED});
  expect(chunks).toContainEqual({type: 'error', errorText: KEY_REJECTED});
  expect(JSON.stringify(chunks)).not.toContain('fake-');
  expect(logged).toEqual([['[agent] model call failed:', 401]]);
});

/// <reference types="bun" />
import {afterEach, expect, spyOn, test} from 'bun:test';
import {APICallError, toUIMessageStream} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {KEY_REJECTED, PROVIDER_FAILED, userMessage} from './errors';
import {runAgent} from './run';

const FAKE_KEY_ECHO = 'Incorrect API key provided: fake-***-4321';
const apiError = (statusCode: number) =>
  new APICallError({message: FAKE_KEY_ECHO, url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode, responseBody: FAKE_KEY_ECHO});

afterEach(() => spyOn(console, 'error').mockRestore());

test('maps provider errors to fixed user messages', () => {
  expect(userMessage(apiError(401))).toBe(KEY_REJECTED);
  expect(userMessage(apiError(403))).toBe(KEY_REJECTED);
  expect(userMessage(apiError(500))).toBe(PROVIDER_FAILED);
  expect(userMessage(new Error(FAKE_KEY_ECHO))).toBe(PROVIDER_FAILED);
});

test('a rejected key reaches the chat as a clear message and never leaks provider text', async () => {
  const logged: unknown[][] = [];
  spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args));
  const model = new MockLanguageModelV4({doStream: async () => { throw apiError(401); }});
  const result = runAgent({model, messages: [{role: 'user', content: 'hi'}]});
  const chunks = [];
  for await (const chunk of toUIMessageStream({stream: result.stream, onError: userMessage})) chunks.push(chunk);
  expect(chunks).toContainEqual({type: 'error', errorText: KEY_REJECTED});
  expect(JSON.stringify(chunks)).not.toContain('fake-');
  expect(logged).toEqual([['[agent] model call failed:', 401]]);
});

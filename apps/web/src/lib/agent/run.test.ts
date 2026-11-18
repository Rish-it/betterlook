/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {simulateReadableStream} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {AGENT_CONFIG} from './config';
import {languageModel, parseCredential, providerOf} from './model';
import {MODELS} from './models';
import {runAgent} from './run';

const usage = {
  inputTokens: {total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined},
  outputTokens: {total: 2, text: 2, reasoning: undefined},
};

const textModel = (chunks: string[], delay?: number) =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunkDelayInMs: delay,
        chunks: [
          {type: 'text-start', id: 't'},
          ...chunks.map(delta => ({type: 'text-delta' as const, id: 't', delta})),
          {type: 'text-end', id: 't'},
          {type: 'finish', finishReason: {unified: 'stop', raw: undefined}, logprobs: undefined, usage},
        ],
      }),
    }),
  });

test('streams the model reply with the configured limits', async () => {
  const model = textModel(['Hel', 'lo']);
  const result = runAgent({model, messages: [{role: 'user', content: 'hi'}]});
  expect(await result.text).toBe('Hello');
  const call = model.doStreamCalls[0];
  expect(call.maxOutputTokens).toBe(AGENT_CONFIG.maxOutputTokens);
  expect(call.providerOptions).toEqual({openai: {store: false}});
});

test('stops streaming when aborted', async () => {
  const controller = new AbortController();
  const result = runAgent({
    model: textModel(Array(50).fill('x'), 10),
    messages: [{role: 'user', content: 'hi'}],
    abortSignal: controller.signal,
  });
  let received = '';
  setTimeout(() => controller.abort(), 50);
  for await (const delta of result.textStream) received += delta;
  expect(received.length).toBeGreaterThan(0);
  expect(received.length).toBeLessThan(50);
});

test('routes models to their provider and rejects mismatches', () => {
  expect(providerOf(MODELS[0].id)).toBe('openai');
  expect(providerOf('gpt-unlisted')).toBeNull();
  expect(providerOf('claude-sonnet-5-5')).toBeNull();
  const model = languageModel('gpt-5', {provider: 'openai', kind: 'api-key', apiKey: 'test'});
  expect(typeof model === 'object' && model.provider).toStartWith('openai');
  expect(() => languageModel('claude-sonnet-5-5', {provider: 'openai', kind: 'api-key', apiKey: 'test'})).toThrow();
});

test('accepts only well-formed credentials', () => {
  expect(parseCredential({provider: 'openai', kind: 'api-key', apiKey: 'k'})).toEqual({provider: 'openai', kind: 'api-key', apiKey: 'k'});
  expect(parseCredential({provider: 'openai', kind: 'oauth', accessToken: 't', expiresAt: 1})?.kind).toBe('oauth');
  expect(parseCredential({provider: 'openai', kind: 'api-key', apiKey: ''})).toBeNull();
  expect(parseCredential({provider: 'anthropic', kind: 'api-key', apiKey: 'k'})).toBeNull();
  expect(parseCredential(null)).toBeNull();
});

test('stops at the configured step limit when the model keeps calling tools', async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: 'loop', input: '{}'},
          {type: 'finish', finishReason: {unified: 'tool-calls', raw: undefined}, logprobs: undefined, usage},
        ],
      }),
    }),
  });
  const result = runAgent({model, messages: [{role: 'user', content: 'hi'}]});
  expect((await result.steps).length).toBe(AGENT_CONFIG.maxSteps);
});

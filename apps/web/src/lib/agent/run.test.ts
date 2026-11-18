/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {simulateReadableStream} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {AGENT_CONFIG} from './config';
import {languageModel, parseCredential} from './model';
import {MODELS, providerOf} from './models';
import {runTurn, tempProject, textStep, toolStep} from './test-project';

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
  const {message, record} = await runTurn({model, messages: [{role: 'user', content: 'hi'}]});
  expect(message.parts.find(p => p.type === 'text')).toMatchObject({text: 'Hello'});
  expect(message.metadata).toEqual({turnId: record.id, traceId: record.traceId, status: 'passed'});
  expect(record.status).toBe('passed');
  const call = model.doStreamCalls[0];
  expect(call.maxOutputTokens).toBe(AGENT_CONFIG.maxOutputTokens);
  expect(call.providerOptions).toEqual({openai: {store: false}, anthropic: {fallbacks: 'default', effort: 'medium', thinking: {type: 'adaptive', display: 'summarized'}}});
  expect(call.temperature).toBeUndefined();
  expect(call.toolChoice).toEqual({type: 'auto'});
});

test('stops streaming when aborted', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const {message, record} = await runTurn({
    model: textModel(Array(50).fill('x'), 10),
    messages: [{role: 'user', content: 'hi'}],
    abortSignal: controller.signal,
  });
  const received = (message.parts.find(p => p.type === 'text') as {text: string} | undefined)?.text ?? '';
  expect(record.status).toBe('stopped');
  expect(received.length).toBeGreaterThan(0);
  expect(received.length).toBeLessThan(50);
});

test('routes models to their provider and rejects mismatches', () => {
  expect(MODELS[0]).toEqual({id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic'});
  expect(providerOf('gpt-5')).toBe('openai');
  expect(providerOf('gpt-unlisted')).toBeNull();
  const model = languageModel('gpt-5', {provider: 'openai', kind: 'api-key', apiKey: 'test'});
  expect(typeof model === 'object' && model.provider).toStartWith('openai');
  const claude = languageModel('claude-sonnet-5-5', {provider: 'anthropic', kind: 'api-key', apiKey: 'test'});
  expect(typeof claude === 'object' && [claude.provider, claude.modelId]).toEqual(['anthropic.messages', 'claude-sonnet-5-5']);
  expect(() => languageModel('claude-sonnet-5-5', {provider: 'openai', kind: 'api-key', apiKey: 'test'})).toThrow();
  expect(() => languageModel('claude-sonnet-5-5', {provider: 'anthropic', kind: 'oauth', accessToken: 'test'})).toThrow();
});

test('accepts only well-formed credentials', () => {
  expect(parseCredential({provider: 'openai', kind: 'api-key', apiKey: 'k'})).toEqual({provider: 'openai', kind: 'api-key', apiKey: 'k'});
  expect(parseCredential({provider: 'openai', kind: 'oauth', accessToken: 't', expiresAt: 1})).toBeNull();
  expect(parseCredential({provider: 'openai', kind: 'api-key', apiKey: ''})).toBeNull();
  expect(parseCredential({provider: 'anthropic', kind: 'api-key', apiKey: 'k'})).toEqual({provider: 'anthropic', kind: 'api-key', apiKey: 'k'});
  expect(parseCredential({provider: 'anthropic', kind: 'oauth', accessToken: 't'})).toBeNull();
  expect(parseCredential({provider: 'google', kind: 'api-key', apiKey: 'k'})).toBeNull();
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
  await runTurn({model, messages: [{role: 'user', content: 'hi'}]});
  expect(model.doStreamCalls.length).toBe(AGENT_CONFIG.maxSteps);
});

test('every model call sets the configured effort and summarized thinking, repair included', async () => {
  const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'}, (_cmd, args) => (args.includes('typecheck') ? {exitCode: 1, output: 'TS1'} : {exitCode: 0, output: '[]'}));
  const edit = toolStep([['e1', 'edit_file', {path: 'src/App.tsx', oldString: 'Hi', newString: 'Hello'}]]);
  const model = new MockLanguageModelV4({doStream: [edit, textStep('Done.'), textStep('Tried.')]});
  try {
    await runTurn({model, messages: [{role: 'user', content: 'hi'}], project: t.project});
  } finally {
    t.cleanup();
  }
  expect(model.doStreamCalls.length).toBe(3);
  for (const call of model.doStreamCalls) {
    expect(call.providerOptions?.anthropic).toEqual({fallbacks: 'default', effort: 'medium', thinking: {type: 'adaptive', display: 'summarized'}});
  }
});

test('the turn record keeps each step finish reason and output tokens, and counts length stops', async () => {
  const cut = {
    stream: simulateReadableStream({
      chunks: [
        {type: 'text-start' as const, id: 't'},
        {type: 'text-delta' as const, id: 't', delta: 'A long answer that'},
        {type: 'text-end' as const, id: 't'},
        {type: 'finish' as const, finishReason: {unified: 'length' as const, raw: 'max_tokens'}, logprobs: undefined, usage: {...usage, outputTokens: {total: 32_000, text: 32_000, reasoning: undefined}}},
      ],
    }),
  };
  const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'});
  const model = new MockLanguageModelV4({doStream: [toolStep([['l1', 'list_files', {}]]), cut]});
  try {
    const {record} = await runTurn({model, messages: [{role: 'user', content: 'explain'}], project: t.project});
    expect(record.steps).toEqual([
      {finishReason: 'tool-calls', outputTokens: 1},
      {finishReason: 'length', outputTokens: 32_000},
    ]);
    expect(record.lengthStops).toBe(1);
  } finally {
    t.cleanup();
  }
});

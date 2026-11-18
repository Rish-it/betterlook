/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {simulateReadableStream} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {AGENT_CONFIG} from './config';
import {languageModel, parseCredential} from './model';
import {MODELS, providerOf} from './models';
import {CANCELLED_STEP_LIMIT, OUTPUT_LIMIT} from './errors';
import type {AgentChunk} from './run';
import {runTurn, tempProject, textStep, toolStep} from './test-project';
import type {AgentMessage} from './types';

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

const unresolvedParts = (message: AgentMessage) =>
  message.parts.filter(p => (p.type.startsWith('tool-') || p.type === 'dynamic-tool') && !['output-available', 'output-error', 'output-denied'].includes((p as {state: string}).state));

const cancelled = (chunks: AgentChunk[], toolCallId: string) =>
  chunks.find(c => (c.type === 'tool-output-error' || c.type === 'tool-input-error') && c.toolCallId === toolCallId) as {errorText: string} | undefined;

test('Stop cancels a running tool call with a reason, in the stream and the record', async () => {
  const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'});
  const slow = {...t.project, read: async (p: string) => (p.endsWith('/src/App.tsx') && (await Bun.sleep(300)), t.project.read(p))};
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const model = new MockLanguageModelV4({doStream: [toolStep([['r1', 'read_file', {path: 'src/App.tsx'}]]), textStep('never')]});
  try {
    const {chunks, message, record} = await runTurn({model, messages: [{role: 'user', content: 'read it'}], project: slow, abortSignal: controller.signal});
    expect(record.status).toBe('stopped');
    expect(cancelled(chunks, 'r1')?.errorText).toStartWith('Cancelled: ');
    expect(record.toolCalls.find(c => c.id === 'r1')).toMatchObject({decision: 'cancelled', result: cancelled(chunks, 'r1')?.errorText});
    expect(unresolvedParts(message)).toEqual([]);
  } finally {
    await Bun.sleep(300);
    t.cleanup();
  }
});

test('a model error mid tool input cancels the call instead of leaving it pending', async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {type: 'tool-input-start' as const, id: 'w1', toolName: 'write_file'},
          {type: 'tool-input-delta' as const, id: 'w1', delta: '{"path":"a.txt","con'},
          {type: 'error' as const, error: new Error('connection reset')},
        ],
      }),
    }),
  });
  const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'});
  try {
    const {chunks, message, record} = await runTurn({model, messages: [{role: 'user', content: 'write it'}], project: t.project});
    expect(record.status).toBe('error');
    expect(cancelled(chunks, 'w1')?.errorText).toStartWith('Cancelled: ');
    expect(record.toolCalls).toMatchObject([{id: 'w1', tool: 'write_file', decision: 'cancelled'}]);
    expect(unresolvedParts(message)).toEqual([]);
  } finally {
    t.cleanup();
  }
});

test('calls the model ended without running are cancelled before the turn checkpoints and verifies', async () => {
  const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'}, cmd => (cmd === 'node' ? {exitCode: 0, output: '[]'} : {exitCode: 0, output: ''}));
  const unrun = {
    stream: simulateReadableStream({
      chunks: [
        {type: 'tool-call' as const, toolCallId: 'w2', toolName: 'write_file', input: JSON.stringify({path: 'b.txt', content: 'b'})},
        {type: 'finish' as const, finishReason: {unified: 'other' as const, raw: undefined}, logprobs: undefined, usage},
      ],
    }),
  };
  const model = new MockLanguageModelV4({doStream: [toolStep([['w1', 'write_file', {path: 'a.txt', content: 'a'}]]), unrun]});
  try {
    const {chunks, message, record} = await runTurn({model, messages: [{role: 'user', content: 'write two'}], project: t.project});
    const at = (match: (c: AgentChunk) => boolean) => chunks.findIndex(match);
    expect(cancelled(chunks, 'w2')?.errorText).toStartWith('Cancelled: ');
    expect(at(c => c.type === 'tool-output-error' && c.toolCallId === 'w2')).toBeLessThan(at(c => c.type === 'data-checkpoint'));
    expect(at(c => c.type === 'data-checkpoint')).toBeGreaterThan(-1);
    expect(record.toolCalls.map(c => [c.id, c.decision])).toEqual([
      ['w1', 'allowed'],
      ['w2', 'cancelled'],
    ]);
    expect(unresolvedParts(message)).toEqual([]);
  } finally {
    t.cleanup();
  }
});

const cutUsage = {...usage, outputTokens: {total: 32_000, text: 32_000, reasoning: undefined}};
const lengthStep = (third: 'input-cut' | 'invalid-call') => ({
  stream: simulateReadableStream({
    chunks: [
      {type: 'tool-call' as const, toolCallId: 'w1', toolName: 'write_file', input: JSON.stringify({path: 'index.html', content: '<html></html>'})},
      {type: 'tool-call' as const, toolCallId: 'w2', toolName: 'write_file', input: JSON.stringify({path: 'src/App.tsx', content: '<h1>Big</h1>\n'})},
      {type: 'tool-input-start' as const, id: 'w3', toolName: 'write_file'},
      {type: 'tool-input-delta' as const, id: 'w3', delta: '{"path":"src/index.css","content":"body {'},
      ...(third === 'invalid-call' ? [{type: 'tool-input-end' as const, id: 'w3'}, {type: 'tool-call' as const, toolCallId: 'w3', toolName: 'write_file', input: '{"path":"src/index.css","content":"body {'}] : []),
      {type: 'finish' as const, finishReason: {unified: 'length' as const, raw: 'max_tokens'}, logprobs: undefined, usage: cutUsage},
    ],
  }),
});

for (const third of ['input-cut', 'invalid-call'] as const) {
  test(`a step cut off by the output limit returns an error for each call and the turn continues (${third})`, async () => {
    const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'}, cmd => (cmd === 'node' ? {exitCode: 0, output: '[]'} : {exitCode: 0, output: ''}));
    const model = new MockLanguageModelV4({
      doStream: [lengthStep(third), toolStep([['e1', 'edit_file', {path: 'src/App.tsx', oldString: 'Hi', newString: 'Big'}]]), textStep('Done.')],
    });
    try {
      const {chunks, message, record} = await runTurn({model, messages: [{role: 'user', content: 'Design a landing page'}], project: t.project});
      expect(cancelled(chunks, 'w1')?.errorText).toBe(OUTPUT_LIMIT);
      expect(cancelled(chunks, 'w2')?.errorText).toBe(OUTPUT_LIMIT);
      expect(cancelled(chunks, 'w3')).toBeDefined();
      expect(unresolvedParts(message)).toEqual([]);

      expect(model.doStreamCalls.length).toBe(3);
      const continued = JSON.stringify(model.doStreamCalls[1].prompt);
      for (const id of ['w1', 'w2', 'w3']) expect(continued).toContain(`"toolCallId":"${id}"`);
      expect(continued.split(OUTPUT_LIMIT).length - 1).toBe(3);
      expect(continued).not.toContain('JSON parsing failed');
      for (const call of model.doStreamCalls) expect(call.providerOptions?.anthropic).toMatchObject({effort: 'medium', thinking: {display: 'summarized'}});

      expect(t.file('src/App.tsx')).toBe('<h1>Big</h1>\n');
      expect(record).toMatchObject({status: 'passed', lengthStops: 1, filesTouched: ['src/App.tsx']});
      expect(record.steps.map(s => s.finishReason)).toEqual(['length', 'tool-calls', 'stop']);
    } finally {
      t.cleanup();
    }
  });
}

test('a length stop on the last allowed step cancels its calls with the step limit as the reason', async () => {
  const t = tempProject({'src/App.tsx': '<h1>Hi</h1>\n'});
  let n = 0;
  const model = new MockLanguageModelV4({doStream: async () => (++n < AGENT_CONFIG.maxSteps ? toolStep([[`l${n}`, 'list_files', {}]]) : lengthStep('input-cut'))});
  try {
    const {chunks, message, record} = await runTurn({model, messages: [{role: 'user', content: 'Design a landing page'}], project: t.project});
    expect(model.doStreamCalls.length).toBe(AGENT_CONFIG.maxSteps);
    for (const id of ['w1', 'w2', 'w3']) expect(cancelled(chunks, id)?.errorText).toBe(CANCELLED_STEP_LIMIT);
    expect(record.toolCalls.filter(c => c.decision === 'cancelled').map(c => c.id)).toEqual(['w1', 'w2', 'w3']);
    expect(record).toMatchObject({stepLimitReached: true, lengthStops: 1, status: 'no-changes'});
    expect(unresolvedParts(message)).toEqual([]);
  } finally {
    t.cleanup();
  }
});

test('sends the project DESIGN.md before the conversation and records the final message', async () => {
  const t = tempProject({'DESIGN.md': '| Area | Invariant |', 'src/App.tsx': 'x'});
  const model = textModel(['Nothing to change.']);
  const {record} = await runTurn({model, messages: [{role: 'user', content: 'hi'}], project: t.project});
  const [context, user] = model.doStreamCalls[0].prompt;
  expect(context).toMatchObject({role: 'user', content: [{type: 'text', text: '<project_file path="DESIGN.md">\n| Area | Invariant |\n</project_file>'}]});
  expect(user).toMatchObject({role: 'user', content: [{type: 'text', text: 'hi'}]});
  expect(record.projectContextHash).toMatch(/^[0-9a-f]{16}$/);
  expect(record.finalMessage).toBe('Nothing to change.');
  t.cleanup();
});

test('sends no project context when the project has no DESIGN.md', async () => {
  const t = tempProject({'src/App.tsx': 'x'});
  const model = textModel(['ok']);
  const {record} = await runTurn({model, messages: [{role: 'user', content: 'hi'}], project: t.project});
  expect(model.doStreamCalls[0].prompt).toHaveLength(1);
  expect(record.projectContextHash).toBeNull();
  t.cleanup();
});

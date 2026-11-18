/// <reference types="bun" />
import {beforeAll, expect, test} from 'bun:test';
import {InMemorySpanExporter, SimpleSpanProcessor} from '@opentelemetry/sdk-trace-base';
import {simulateReadableStream} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {AGENT_CONFIG} from './config';
import {runAgent, SYSTEM_PROMPT_HASH, TOOL_CONFIG_HASH} from './run';
import {TOOL_DEFINITIONS} from './tools';
import {REPAIR_PROMPT, SYSTEM_PROMPT} from './system-prompt';
import {hashOf, maskSecrets, registerSecret, setupTelemetry} from './trace';

const exporter = new InMemorySpanExporter();
const ENV_SECRET = 'env-secret-value-0001';
const USER_KEY = 'sk-proj-userkeyABCDEF123456';

beforeAll(() => {
  process.env.FAKE_EVAL_API_KEY = ENV_SECRET;
  setupTelemetry(new SimpleSpanProcessor(exporter));
});

const usage = {
  inputTokens: {total: 12, noCache: 2, cacheRead: 10, cacheWrite: undefined},
  outputTokens: {total: 5, text: 5, reasoning: undefined},
};

test('masks env secrets and key patterns', () => {
  const env = {OPENAI_EVAL_API_KEY: 'abcdefgh12345', LANGFUSE_BASE_URL: 'https://cloud.langfuse.com'};
  expect(maskSecrets('key abcdefgh12345 at https://cloud.langfuse.com', env)).toBe('key [REDACTED] at https://cloud.langfuse.com');
  expect(maskSecrets(`use ${USER_KEY} or Bearer abc.def`, {})).toBe('use [REDACTED] or [REDACTED]');
  expect(maskSecrets('anthropic sk-ant-api03-fakefakefake_0123-xyz end', {})).toBe('anthropic [REDACTED] end');
  expect(maskSecrets('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIx.c2lnbmF0dXJl', {})).toBe('jwt [REDACTED]');
});

test('hashes change when the prompt or the tool config changes', () => {
  expect(hashOf('prompt v1')).not.toBe(hashOf('prompt v2'));
  expect(hashOf({...AGENT_CONFIG, maxSteps: AGENT_CONFIG.maxSteps + 1})).not.toBe(hashOf(AGENT_CONFIG));
  expect(hashOf(AGENT_CONFIG)).toBe(hashOf({...AGENT_CONFIG}));
  expect(SYSTEM_PROMPT_HASH).toBe(hashOf({system: SYSTEM_PROMPT, repair: REPAIR_PROMPT}));
  expect(hashOf({system: SYSTEM_PROMPT, repair: `${REPAIR_PROMPT}!`})).not.toBe(SYSTEM_PROMPT_HASH);
  expect(TOOL_CONFIG_HASH).toBe(hashOf({config: AGENT_CONFIG, tools: TOOL_DEFINITIONS}));
  const editedTools = {...TOOL_DEFINITIONS, read_file: {...TOOL_DEFINITIONS.read_file, description: 'Read a file.'}};
  expect(hashOf({config: AGENT_CONFIG, tools: editedTools})).not.toBe(TOOL_CONFIG_HASH);
});

test('a turn produces one record and one masked trace with the model spans inside it', async () => {
  exporter.reset();
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {type: 'text-start', id: 't'},
          {type: 'text-delta', id: 't', delta: `leaked ${USER_KEY} and ${ENV_SECRET}`},
          {type: 'text-end', id: 't'},
          {type: 'finish', finishReason: {unified: 'stop', raw: undefined}, logprobs: undefined, usage},
        ],
      }),
    }),
  });
  const {stream, turn} = runAgent({model, messages: [{role: 'user', content: `make it blue ${ENV_SECRET}`}]});
  for await (const _ of stream);
  const record = await turn;

  expect(record).toMatchObject({
    prompt: `make it blue ${ENV_SECRET}`,
    provider: 'mock-provider',
    model: 'mock-model-id',
    systemPromptHash: SYSTEM_PROMPT_HASH,
    toolConfigHash: TOOL_CONFIG_HASH,
    status: 'passed',
    usage: {inputTokens: 12, outputTokens: 5, cachedInputTokens: 10, costUsd: null},
    steps: [{finishReason: 'stop', outputTokens: 5}],
    lengthStops: 0,
  });
  expect(record.endedAt).not.toBeNull();

  const spans = exporter.getFinishedSpans();
  const root = spans.find(s => s.name === 'betterlook.turn')!;
  expect(root.spanContext().traceId).toBe(record.traceId);
  expect(spans.every(s => s.spanContext().traceId === record.traceId)).toBe(true);
  expect(spans.length).toBeGreaterThan(1);
  expect(JSON.parse(root.attributes['langfuse.trace.output'] as string)).toMatchObject({id: record.id, status: 'passed'});
  expect(root.attributes['langfuse.trace.metadata.toolConfigHash']).toBe(record.toolConfigHash);
  expect(root.attributes['langfuse.trace.metadata.lengthStops']).toBe(0);

  const exported = JSON.stringify(spans.map(s => ({a: s.attributes, e: s.events})));
  expect(exported).toContain('[REDACTED]');
  expect(exported).not.toContain(ENV_SECRET);
  expect(exported).not.toContain(USER_KEY);
});

test('a registered secret, like an eval canary, is masked even though it is not in the environment', () => {
  registerSecret('blk_0123456789abcdef0123456789abcdef');
  expect(maskSecrets('token blk_0123456789abcdef0123456789abcdef here', {})).toBe('token [REDACTED] here');
});

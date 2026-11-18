import {randomUUID} from 'node:crypto';
import {context, trace} from '@opentelemetry/api';
import {isStepCount, streamText, type LanguageModel, type LanguageModelUsage, type ModelMessage} from 'ai';
import {AGENT_CONFIG} from './config';
import {errorStatus, userMessage} from './errors';
import {SYSTEM_PROMPT} from './system-prompt';
import {hashOf, TRACER_NAME} from './trace';
import type {TurnRecord, Usage} from './types';

const usageOf = (u: LanguageModelUsage): Usage => ({
  inputTokens: u.inputTokens ?? 0,
  outputTokens: u.outputTokens ?? 0,
  cachedInputTokens: u.inputTokenDetails.cacheReadTokens ?? 0,
  costUsd: null,
});

const lastUserText = (messages: ModelMessage[]) => {
  const content = messages.findLast(m => m.role === 'user')?.content;
  return typeof content === 'string' ? content : (content ?? []).map(p => (p.type === 'text' ? p.text : '')).join('');
};

export function runAgent({
  model,
  messages,
  abortSignal,
}: {
  model: Exclude<LanguageModel, string>;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}) {
  const span = trace.getTracer(TRACER_NAME).startSpan('betterlook.turn');
  const record: TurnRecord = {
    id: randomUUID(),
    traceId: span.spanContext().traceId,
    sandboxId: '',
    prompt: lastUserText(messages),
    provider: model.provider,
    model: model.modelId,
    systemPromptHash: hashOf(SYSTEM_PROMPT),
    toolConfigHash: hashOf(AGENT_CONFIG),
    toolCalls: [],
    usage: {inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: null},
    diff: '',
    filesTouched: [],
    verify: null,
    repairAttempted: false,
    repairVerify: null,
    status: 'running',
    checkpoint: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  span.setAttributes({
    'langfuse.trace.name': 'betterlook.turn',
    'langfuse.trace.input': record.prompt,
    'langfuse.trace.metadata.turnId': record.id,
    'langfuse.trace.metadata.systemPromptHash': record.systemPromptHash,
    'langfuse.trace.metadata.toolConfigHash': record.toolConfigHash,
  });

  let resolveTurn: (turn: TurnRecord) => void;
  const turn = new Promise<TurnRecord>(resolve => (resolveTurn = resolve));
  const end = (patch: Partial<TurnRecord>) => {
    if (record.endedAt) return;
    Object.assign(record, patch, {endedAt: new Date().toISOString()});
    span.setAttributes({
      'langfuse.trace.output': JSON.stringify(record),
      'langfuse.trace.metadata.status': record.status,
    });
    span.end();
    resolveTurn(record);
  };

  const result = context.with(trace.setSpan(context.active(), span), () =>
    streamText({
      model,
      instructions: SYSTEM_PROMPT || undefined,
      messages,
      stopWhen: isStepCount(AGENT_CONFIG.maxSteps),
      maxOutputTokens: AGENT_CONFIG.maxOutputTokens,
      providerOptions: {openai: {store: false}},
      abortSignal,
      onEnd: e => end({status: 'passed', usage: usageOf(e.totalUsage)}),
      onAbort: () => end({status: 'stopped'}),
      onError: ({error}) => {
        console.error('[agent] model call failed:', errorStatus(error));
        end({status: 'error', error: userMessage(error)});
      },
    }),
  );
  return {result, turn};
}

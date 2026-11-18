import {randomUUID} from 'node:crypto';
import {context, trace} from '@opentelemetry/api';
import {
  createUIMessageStream,
  isStepCount,
  streamText,
  toUIMessageStream,
  type InferUIMessageChunk,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import type {Project} from '../sandbox/project';
import {AGENT_CONFIG} from './config';
import {errorStatus, userMessage} from './errors';
import {SYSTEM_PROMPT} from './system-prompt';
import {checkPolicy} from './policy';
import {createTools, proposedDiff, TOOL_DEFINITIONS} from './tools';
import {hashOf, TRACER_NAME} from './trace';
import type {AgentMessage, DeniedCall, ToolName, TurnRecord, Usage} from './types';

export type AgentChunk = InferUIMessageChunk<AgentMessage>;

export const TOOL_CONFIG_HASH = hashOf({config: AGENT_CONFIG, tools: TOOL_DEFINITIONS});

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

async function approvalDiff(project: Project, tool: string, input: {path: string; oldString?: string; newString?: string; content?: string}, path: string) {
  const before = await project.read(`${project.root}/${path}`).catch(() => null);
  if (tool === 'write_file') return proposedDiff(path, before, input.content ?? '');
  return proposedDiff(path, input.oldString ?? '', input.newString ?? '');
}

export function runAgent({
  model,
  messages,
  project,
  abortSignal,
  onData,
}: {
  model: Exclude<LanguageModel, string>;
  messages: ModelMessage[];
  project?: Project;
  abortSignal?: AbortSignal;
  onData?: (chunk: AgentChunk) => void;
}) {
  const span = trace.getTracer(TRACER_NAME).startSpan('betterlook.turn');
  const record: TurnRecord = {
    id: randomUUID(),
    traceId: span.spanContext().traceId,
    sandboxId: project?.id ?? '',
    prompt: lastUserText(messages),
    provider: model.provider,
    model: model.modelId,
    systemPromptHash: hashOf(SYSTEM_PROMPT),
    toolConfigHash: TOOL_CONFIG_HASH,
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
      providerOptions: {
        openai: {store: false, ...(AGENT_CONFIG.promptCachePerProject && project ? {promptCacheKey: project.id} : {})},
      },
      tools: project ? createTools(project, record.toolCalls) : undefined,
      toolApproval: async ({toolCall}) => {
        if (!project) return undefined;
        const decision = checkPolicy(toolCall.toolName, toolCall.input, project.root);
        if (decision.type === 'deny') {
          const denied: DeniedCall = {
            toolCallId: toolCall.toolCallId,
            tool: toolCall.toolName,
            args: toolCall.input,
            reason: decision.reason,
            message: decision.message,
            at: new Date().toISOString(),
          };
          console.warn('[policy] denied:', denied.tool, denied.reason);
          record.toolCalls.push({id: denied.toolCallId, tool: denied.tool, args: denied.args, result: denied.message, decision: 'denied', denied, startedAt: denied.at, durationMs: 0});
          onData?.({type: 'data-denied', id: denied.toolCallId, data: denied});
          return {type: 'denied', reason: decision.message};
        }
        if (decision.type === 'approve') {
          const input = toolCall.input as {path: string};
          const diff = await approvalDiff(project, toolCall.toolName, input, decision.path);
          onData?.({type: 'data-approval', id: toolCall.toolCallId, data: {toolCallId: toolCall.toolCallId, tool: toolCall.toolName as ToolName, path: decision.path, diff}});
          return 'user-approval';
        }
        return undefined;
      },
      abortSignal,
      onEnd: e =>
        end({
          status: e.content.some(p => p.type === 'tool-approval-request' && !p.isAutomatic) ? 'awaiting-approval' : 'passed',
          usage: usageOf(e.totalUsage),
        }),
      onAbort: () => end({status: 'stopped'}),
      onError: ({error}) => {
        console.error('[agent] model call failed:', errorStatus(error));
        end({status: 'error', error: userMessage(error)});
      },
    }),
  );
  return {result, turn};
}

export function agentUIStream(options: Omit<Parameters<typeof runAgent>[0], 'onData'>) {
  return createUIMessageStream<AgentMessage>({
    execute: ({writer}) => {
      const {result} = runAgent({...options, onData: chunk => writer.write(chunk)});
      writer.merge(toUIMessageStream({stream: result.stream, onError: userMessage}));
    },
    onError: userMessage,
  });
}

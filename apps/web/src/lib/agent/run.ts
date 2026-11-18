import {randomUUID} from 'node:crypto';
import {context, trace} from '@opentelemetry/api';
import {
  createUIMessageStream,
  isStepCount,
  streamText,
  toUIMessageStream,
  type GenerateTextEndEvent,
  type InferUIMessageChunk,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import type {Project} from '../sandbox/project';
import {commitTurn} from './checkpoint';
import {AGENT_CONFIG} from './config';
import {errorStatus, SANDBOX_FAILED, userMessage} from './errors';
import {logEvent} from './events';
import {checkPolicy} from './policy';
import {REPAIR_PROMPT, SYSTEM_PROMPT} from './system-prompt';
import {createTools, proposedDiff, TOOL_DEFINITIONS} from './tools';
import {hashOf, TRACER_NAME} from './trace';
import type {AgentMessage, DeniedCall, ToolName, TurnRecord, Usage, VerifyResult} from './types';
import {verifyProject} from './verify';

export type AgentChunk = InferUIMessageChunk<AgentMessage>;

export const SYSTEM_PROMPT_HASH = hashOf({system: SYSTEM_PROMPT, repair: REPAIR_PROMPT});
export const TOOL_CONFIG_HASH = hashOf({config: AGENT_CONFIG, tools: TOOL_DEFINITIONS});

type Outcome = {type: 'end'; event: GenerateTextEndEvent<ToolSet>} | {type: 'stopped'} | {type: 'error'; error: unknown};

const addUsage = (total: Usage, u: LanguageModelUsage) => {
  total.inputTokens += u.inputTokens ?? 0;
  total.outputTokens += u.outputTokens ?? 0;
  total.cachedInputTokens += u.inputTokenDetails.cacheReadTokens ?? 0;
};

const lastUserText = (messages: ModelMessage[]) => {
  const content = messages.findLast(m => m.role === 'user')?.content;
  return typeof content === 'string' ? content : (content ?? []).map(p => (p.type === 'text' ? p.text : '')).join('');
};

export const repairMessage = (verify: VerifyResult) =>
  REPAIR_PROMPT.replace(
    '{errors}',
    verify.checks
      .filter(c => c.status === 'failed')
      .map(c => `${c.name}:\n${c.errors.join('\n')}`)
      .join('\n\n'),
  );

async function approvalDiff(project: Project, tool: string, input: {path: string; oldString?: string; newString?: string; content?: string}, path: string) {
  if (tool !== 'write_file') return proposedDiff(path, input.oldString ?? '', input.newString ?? '');
  const before = await project.read(`${project.root}/${path}`).catch(() => null);
  return proposedDiff(path, before, input.content ?? '');
}

function approvalEvents(messages: ModelMessage[], turnId: string, traceId: string) {
  const last = messages.at(-1);
  if (last?.role !== 'tool') return;
  const requests = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    for (const p of m.content) if (p.type === 'tool-approval-request') requests.set(p.approvalId, p.toolCallId);
  }
  for (const p of last.content) {
    if (p.type !== 'tool-approval-response') continue;
    const toolCallId = requests.get(p.approvalId) ?? p.approvalId;
    logEvent({type: p.approved ? 'approve' : 'deny', turnId, traceId, toolCallId, at: new Date().toISOString()});
  }
}

export function runAgent({
  model,
  messages,
  project,
  abortSignal,
}: {
  model: Exclude<LanguageModel, string>;
  messages: ModelMessage[];
  project?: Project;
  abortSignal?: AbortSignal;
}) {
  const span = trace.getTracer(TRACER_NAME).startSpan('betterlook.turn');
  const spanContext = trace.setSpan(context.active(), span);
  const record: TurnRecord = {
    id: randomUUID(),
    traceId: span.spanContext().traceId,
    sandboxId: project?.id ?? '',
    prompt: lastUserText(messages),
    provider: model.provider,
    model: model.modelId,
    systemPromptHash: SYSTEM_PROMPT_HASH,
    toolConfigHash: TOOL_CONFIG_HASH,
    toolCalls: [],
    usage: {inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: null},
    diff: '',
    filesTouched: [],
    verify: null,
    repairAttempted: false,
    repairVerify: null,
    stepLimitReached: false,
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
    Object.assign(record, patch, {endedAt: new Date().toISOString()});
    span.setAttributes({
      'langfuse.trace.output': JSON.stringify(record),
      'langfuse.trace.metadata.status': record.status,
      'langfuse.trace.metadata.checkpointId': record.checkpoint?.id ?? '',
    });
    span.end();
    resolveTurn(record);
  };

  const stream = createUIMessageStream<AgentMessage>({
    execute: async ({writer}) => {
      const callModel = (callMessages: ModelMessage[]) => {
        let settle: (outcome: Outcome) => void;
        const outcome = new Promise<Outcome>(resolve => (settle = resolve));
        const result = context.with(spanContext, () =>
          streamText({
            model,
            instructions: SYSTEM_PROMPT || undefined,
            messages: callMessages,
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
                writer.write({type: 'data-denied', id: denied.toolCallId, data: denied});
                return {type: 'denied', reason: decision.message};
              }
              if (decision.type === 'approve') {
                const diff = await approvalDiff(project, toolCall.toolName, toolCall.input as {path: string}, decision.path);
                writer.write({type: 'data-approval', id: toolCall.toolCallId, data: {toolCallId: toolCall.toolCallId, tool: toolCall.toolName as ToolName, path: decision.path, diff}});
                return 'user-approval';
              }
              return undefined;
            },
            abortSignal,
            onEnd: event => settle({type: 'end', event}),
            onAbort: () => settle({type: 'stopped'}),
            onError: ({error}) => {
              console.error('[agent] model call failed:', errorStatus(error));
              settle({type: 'error', error});
            },
          }),
        );
        return {result, outcome};
      };

      const settled = (outcome: Outcome) => {
        if (outcome.type === 'end') {
          addUsage(record.usage, outcome.event.totalUsage);
          return true;
        }
        end(outcome.type === 'stopped' ? {status: 'stopped'} : {status: 'error', error: userMessage(outcome.error)});
        return false;
      };

      try {
        approvalEvents(messages, record.id, record.traceId);
        const first = callModel(messages);
        writer.merge(
          toUIMessageStream({
            stream: first.result.stream,
            sendFinish: false,
            onError: userMessage,
            messageMetadata: ({part}) => (part.type === 'start' ? {turnId: record.id, traceId: record.traceId} : undefined),
          }),
        );
        const outcome = await first.outcome;
        if (!settled(outcome) || outcome.type !== 'end') return;
        if (outcome.event.content.some(p => p.type === 'tool-approval-request' && !p.isAutomatic)) return end({status: 'awaiting-approval'});
        if (!project) return end({status: 'passed'});

        const saved = await commitTurn(project, record.id);
        writer.write({type: 'data-checkpoint', id: 'checkpoint', data: saved.checkpoint});
        writer.write({type: 'data-diff', id: 'diff', data: saved.diff});
        const verify = await verifyProject(project);
        writer.write({type: 'data-verify', id: 'verify', data: verify});
        if (verify.ok) return end({status: 'passed', verify, checkpoint: saved.checkpoint, ...saved.diff});

        const repair = callModel([...messages, ...(await first.result.response).messages, {role: 'user', content: repairMessage(verify)}]);
        writer.merge(toUIMessageStream({stream: repair.result.stream, sendStart: false, sendFinish: false, onError: userMessage}));
        const repairOutcome = await repair.outcome;
        if (!settled(repairOutcome)) return;
        const repaired = await commitTurn(project, record.id, saved.checkpoint.parentId);
        writer.write({type: 'data-checkpoint', id: 'checkpoint', data: repaired.checkpoint});
        writer.write({type: 'data-diff', id: 'diff', data: repaired.diff});
        const repairVerify = await verifyProject(project);
        writer.write({type: 'data-verify', id: 'repair-verify', data: repairVerify});
        end({
          status: repairVerify.ok ? 'passed' : 'failed',
          verify,
          repairAttempted: true,
          repairVerify,
          checkpoint: repaired.checkpoint,
          ...repaired.diff,
        });
      } catch (error) {
        console.error('[agent] turn failed:', error instanceof Error ? error.message : 'unknown');
        if (!record.endedAt) end({status: 'error', error: SANDBOX_FAILED});
        writer.write({type: 'error', errorText: SANDBOX_FAILED});
      } finally {
        writer.write({type: 'finish'});
      }
    },
    onError: userMessage,
  });

  return {stream, turn};
}

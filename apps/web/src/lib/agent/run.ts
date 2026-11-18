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
import {CANCELLED_ENDED, CANCELLED_ERROR, CANCELLED_STOPPED, errorStatus, NO_CHANGES, REFUSED, sandboxMessage, STEP_LIMIT, UNVERIFIED, userMessage, VERIFY_FAILED, WRITE_FAILED} from './errors';
import {logEvent} from './events';
import {checkPolicy} from './policy';
import {REPAIR_PROMPT, SYSTEM_PROMPT} from './system-prompt';
import {createTools, proposedDiff, TOOL_DEFINITIONS} from './tools';
import {hashOf, TRACER_NAME} from './trace';
import type {AgentMessage, DeniedCall, ToolCallRecord, ToolName, TurnRecord, Usage, VerifyResult} from './types';
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

export function noticeFor(record: TurnRecord): string | undefined {
  if (record.status === 'error') return record.error;
  if (record.status === 'failed') return (record.repairVerify ?? record.verify)?.ok === false ? VERIFY_FAILED : WRITE_FAILED;
  if (record.status === 'unverified') return UNVERIFIED;
  if (record.stepLimitReached && record.status !== 'stopped') return STEP_LIMIT;
  if (record.status === 'no-changes') return NO_CHANGES;
  return undefined;
}

const lastUserText = (messages: ModelMessage[]) => {
  const content = messages.findLast(m => m.role === 'user')?.content;
  return typeof content === 'string' ? content : (content ?? []).map(p => (p.type === 'text' ? p.text : '')).join('');
};

// A write failed when the last write that ran on its path ended in error; a later successful write to the path fixes it.
function writeFailed(toolCalls: ToolCallRecord[]) {
  const last = new Map<string, unknown>();
  for (const c of toolCalls) {
    if ((c.tool === 'write_file' || c.tool === 'edit_file') && (c.decision === 'allowed' || c.decision === 'approved')) last.set((c.args as {path: string}).path, c.result);
  }
  return [...last.values()].some(result => (result as {error?: string} | null)?.error !== undefined);
}

// A skipped check is never a pass: the turn is only 'passed' when every check ran and passed and no write failed.
const checkedStatus = (verify: VerifyResult, toolCalls: ToolCallRecord[]) =>
  writeFailed(toolCalls) ? 'failed' : verify.checks.every(c => c.status === 'passed') ? 'passed' : 'unverified';

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
  keepSandbox = false,
}: {
  model: Exclude<LanguageModel, string>;
  messages: ModelMessage[];
  project?: Project;
  abortSignal?: AbortSignal;
  keepSandbox?: boolean;
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
    steps: [],
    lengthStops: 0,
    stepLimitReached: false,
    status: 'running',
    checkpoint: null,
    sandbox: null,
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
  const end = (patch: Partial<TurnRecord>) => void Object.assign(record, patch, {endedAt: new Date().toISOString()});
  const finalize = () => {
    span.setAttributes({
      'langfuse.trace.output': JSON.stringify(record),
      'langfuse.trace.metadata.status': record.status,
      'langfuse.trace.metadata.lengthStops': record.lengthStops,
      'langfuse.trace.metadata.checkpointId': record.checkpoint?.id ?? '',
    });
    span.end();
    resolveTurn(record);
  };

  const stream = createUIMessageStream<AgentMessage>({
    execute: async ({writer}) => {
      const tools = project ? createTools(project, record.toolCalls) : undefined;
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
            // Claude Sonnet 5.5 400s on non-default sampling, forced toolChoice and disabled thinking, so none are set.
            providerOptions: {
              openai: {store: false, ...(AGENT_CONFIG.promptCachePerProject && project ? {promptCacheKey: project.id} : {})},
              anthropic: {fallbacks: 'default', effort: AGENT_CONFIG.effort, thinking: {type: 'adaptive', display: AGENT_CONFIG.thinkingDisplay}},
            },
            tools,
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
          record.steps.push(...outcome.event.steps.map(s => ({finishReason: s.finishReason, outputTokens: s.usage.outputTokens ?? 0})));
          record.lengthStops = record.steps.filter(s => s.finishReason === 'length').length;
          if (outcome.event.finishReason === 'content-filter') {
            end({status: 'error', error: REFUSED});
            return false;
          }
          if (outcome.event.steps.length >= AGENT_CONFIG.maxSteps && outcome.event.finishReason === 'tool-calls') record.stepLimitReached = true;
          return true;
        }
        end(outcome.type === 'stopped' ? {status: 'stopped'} : {status: 'error', error: userMessage(outcome.error)});
        return false;
      };

      // Every tool call the client has seen without a terminal chunk yet; approval requests are the only legitimate wait.
      const open = new Map<string, {toolName: string; input?: unknown; approval?: boolean}>();
      const track = (chunk: AgentChunk) => {
        if (chunk.type === 'tool-input-start') open.set(chunk.toolCallId, {toolName: chunk.toolName});
        else if (chunk.type === 'tool-input-available') open.set(chunk.toolCallId, {toolName: chunk.toolName, input: chunk.input});
        else if (chunk.type === 'tool-approval-request' && !chunk.isAutomatic) open.set(chunk.toolCallId, {...open.get(chunk.toolCallId)!, approval: true});
        else if (chunk.type === 'tool-input-error' || chunk.type === 'tool-output-error' || chunk.type === 'tool-output-denied') open.delete(chunk.toolCallId);
        else if (chunk.type === 'tool-output-available' && !chunk.preliminary) open.delete(chunk.toolCallId);
      };
      const cancelOpen = (reason: string) => {
        for (const [toolCallId, call] of open) {
          if (call.approval) continue;
          open.delete(toolCallId);
          writer.write(
            'input' in call
              ? {type: 'tool-output-error', toolCallId, errorText: reason}
              : {type: 'tool-input-error', toolCallId, toolName: call.toolName, input: undefined, errorText: reason},
          );
          const recorded = record.toolCalls.find(c => c.id === toolCallId);
          if (recorded) Object.assign(recorded, {decision: 'cancelled', result: reason});
          else record.toolCalls.push({id: toolCallId, tool: call.toolName, args: call.input ?? null, result: reason, decision: 'cancelled', startedAt: new Date().toISOString(), durationMs: 0});
        }
      };

      const runModel = async (callMessages: ModelMessage[], first: boolean) => {
        const call = callModel(callMessages);
        const chunks = toUIMessageStream<ToolSet, AgentMessage>({
          stream: call.result.stream,
          sendStart: first,
          sendFinish: false,
          onError: userMessage,
          messageMetadata: ({part}) => (part.type === 'start' ? {turnId: record.id, traceId: record.traceId} : undefined),
        });
        for await (const chunk of chunks) {
          track(chunk);
          writer.write(chunk);
        }
        const outcome = await call.outcome;
        if (outcome.type !== 'end') return {outcome, messages: callMessages};
        cancelOpen(CANCELLED_ENDED);
        return {outcome, messages: [...callMessages, ...(await call.result.response).messages]};
      };

      try {
        approvalEvents(messages, record.id, record.traceId);
        const first = await runModel(messages, true);
        const outcome = first.outcome;
        if (!settled(outcome) || outcome.type !== 'end') return;
        if (outcome.event.content.some(p => p.type === 'tool-approval-request' && !p.isAutomatic)) return end({status: 'awaiting-approval'});
        if (!project) return end({status: 'passed'});

        const saved = await commitTurn(project, record.id);
        if (!saved) return end({status: 'no-changes'});
        writer.write({type: 'data-checkpoint', id: 'checkpoint', data: saved.checkpoint});
        writer.write({type: 'data-diff', id: 'diff', data: saved.diff});
        const verify = await verifyProject(project);
        writer.write({type: 'data-verify', id: 'verify', data: verify});
        if (verify.ok) return end({status: checkedStatus(verify, record.toolCalls), verify, checkpoint: saved.checkpoint, ...saved.diff});

        const repair = await runModel([...first.messages, {role: 'user', content: repairMessage(verify)}], false);
        if (!settled(repair.outcome)) return;
        const repaired = (await commitTurn(project, record.id, saved.checkpoint.parentId)) ?? saved;
        writer.write({type: 'data-checkpoint', id: 'checkpoint', data: repaired.checkpoint});
        writer.write({type: 'data-diff', id: 'diff', data: repaired.diff});
        const repairVerify = await verifyProject(project);
        writer.write({type: 'data-verify', id: 'repair-verify', data: repairVerify});
        end({
          status: repairVerify.ok ? checkedStatus(repairVerify, record.toolCalls) : 'failed',
          verify,
          repairAttempted: true,
          repairVerify,
          checkpoint: repaired.checkpoint,
          ...repaired.diff,
        });
      } catch (error) {
        console.error('[agent] turn failed:', error instanceof Error ? error.message : 'unknown');
        const message = sandboxMessage(error);
        if (!record.endedAt) end({status: 'error', error: message});
        writer.write({type: 'error', errorText: message});
      } finally {
        cancelOpen(record.status === 'stopped' ? CANCELLED_STOPPED : CANCELLED_ERROR);
        writer.write({type: 'finish', messageMetadata: {status: record.status, notice: noticeFor(record)}});
        // Stopped as soon as the turn ends, so the Hobby CPU quota is not spent idling until the timeout.
        if (project?.stop && !keepSandbox) record.sandbox = await project.stop().catch(() => null);
        finalize();
      }
    },
    onError: userMessage,
  });

  return {stream, turn};
}

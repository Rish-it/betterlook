import type {ReasoningUIPart} from 'ai';
import type {AgentMessage} from '@/lib/agent/types';
import type {ToolPart} from './ToolCall';

type Part = AgentMessage['parts'][number];

export const toolName = (part: ToolPart) => (part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5));

export const isToolPart = (part: Part): part is ToolPart => part.type === 'dynamic-tool' || part.type.startsWith('tool-');

// The card needs the data-approval part's path and diff; without it there is nothing to approve.
export function unshownApprovals(messages: AgentMessage[]): string[] {
  return messages.flatMap(m => {
    const cards = new Set(m.parts.flatMap(p => (p.type === 'data-approval' ? [p.data.toolCallId] : [])));
    return m.parts.flatMap(p => (isToolPart(p) && p.state === 'approval-requested' && !cards.has(p.toolCallId) ? [p.approval.id] : []));
  });
}

export const uniqueById = (messages: AgentMessage[]) => [...new Map(messages.map(m => [m.id, m])).values()];

// data-diff is sent only when a turn changed files.
export const changedFiles = (message: AgentMessage) => message.parts.some(p => p.type === 'data-diff' && p.data.diff !== '');

export const hasThought = (part: ReasoningUIPart) => part.text.trim() !== '';

// Every cancelled call's errorText starts with "Cancelled: " (lib/agent/errors.ts).
export const cancelReason = (part: ToolPart) => (part.state === 'output-error' && part.errorText.startsWith('Cancelled: ') ? part.errorText : undefined);

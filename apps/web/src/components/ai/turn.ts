import type {AgentMessage} from '@/lib/agent/types';
import type {ToolPart} from './ToolCall';

type Part = AgentMessage['parts'][number];

export const isToolPart = (part: Part): part is ToolPart => part.type === 'dynamic-tool' || part.type.startsWith('tool-');

// The card needs the data-approval part's path and diff; without it there is nothing to approve.
export function unshownApprovals(messages: AgentMessage[]): string[] {
  return messages.flatMap(m => {
    const cards = new Set(m.parts.flatMap(p => (p.type === 'data-approval' ? [p.data.toolCallId] : [])));
    return m.parts.flatMap(p => (isToolPart(p) && p.state === 'approval-requested' && !cards.has(p.toolCallId) ? [p.approval.id] : []));
  });
}

export const uniqueById = (messages: AgentMessage[]) => [...new Map(messages.map(m => [m.id, m])).values()];

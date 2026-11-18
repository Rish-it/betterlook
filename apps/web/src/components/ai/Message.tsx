import type {ReasoningUIPart} from 'ai';
import type {AgentMessage, TurnEvent} from '@/lib/agent/types';
import * as stylex from '@stylexjs/stylex';
import {ChatMessage, ChatMessageBubble} from '@astryxdesign/core/Chat';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Text} from '@astryxdesign/core/Text';
import {MODELS} from '@/lib/agent/models';
import {ApprovalCard, type ApprovalDecision} from './ApprovalCard';
import {Checkpoint} from './Checkpoint';
import {DeniedCall} from './DeniedCall';
import {DiffView} from './DiffView';
import {ToolCall, type ToolPart} from './ToolCall';
import {VerifyResult} from './VerifyResult';

type Part = AgentMessage['parts'][number];

type MessageProps = {
  message: AgentMessage;
  onApproval?(approvalId: string, approved: boolean): void;
  onEvent?(event: TurnEvent): void;
};

const styles = stylex.create({
  reasoning: {whiteSpace: 'pre-wrap'},
});

const isToolPart = (part: Part): part is ToolPart => part.type === 'dynamic-tool' || part.type.startsWith('tool-');

function decisionOf(part: ToolPart): ApprovalDecision {
  if (part.state === 'approval-requested') return 'pending';
  if (part.state === 'output-denied' || (part.state === 'approval-responded' && !part.approval.approved)) return 'denied';
  return 'approved';
}

function Reasoning({part}: {part: ReasoningUIPart}) {
  const isStreaming = part.state === 'streaming';
  return (
    <Collapsible
      defaultIsOpen={isStreaming}
      trigger={
        <Text type="supporting" color="secondary">
          {isStreaming ? 'Thinking' : 'Thought'}
        </Text>
      }>
      <Text type="supporting" color="secondary" xstyle={styles.reasoning}>
        {part.text}
      </Text>
    </Collapsible>
  );
}

export function Message({message, onApproval, onEvent}: MessageProps) {
  if (message.role === 'user') {
    const text = message.parts.flatMap(p => (p.type === 'text' ? [p.text] : [])).join('\n');
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble variant="filled">{text}</ChatMessageBubble>
      </ChatMessage>
    );
  }

  const denied = new Map(message.parts.flatMap(p => (p.type === 'data-denied' ? [[p.data.toolCallId, p.data] as const] : [])));
  const approvals = new Map(message.parts.flatMap(p => (p.type === 'data-approval' ? [[p.data.toolCallId, p.data] as const] : [])));
  const toolIds = new Set(message.parts.flatMap(p => (isToolPart(p) ? [p.toolCallId] : [])));
  const label = MODELS.find(m => m.id === message.metadata?.model)?.label;

  return (
    <ChatMessage
      sender="assistant"
      metadata={
        label && (
          <Text type="supporting" color="secondary">
            {label}
          </Text>
        )
      }>
      {/* Parts are append-only and text parts carry no id, so the index is their stable identity. */}
      {message.parts.map((part, i) => {
        if (part.type === 'text')
          return (
            <Markdown key={`text-${i}`} isStreaming={part.state === 'streaming'}>
              {part.text}
            </Markdown>
          );
        if (part.type === 'reasoning') return <Reasoning key={part.id ?? `reasoning-${i}`} part={part} />;
        if (isToolPart(part)) {
          const deniedCall = denied.get(part.toolCallId);
          if (deniedCall) return <DeniedCall key={part.toolCallId} call={deniedCall} />;
          const approval = approvals.get(part.toolCallId);
          const approvalId = part.approval?.id;
          if (approval && approvalId && part.state !== 'output-available' && part.state !== 'output-error')
            return (
              <ApprovalCard
                key={part.toolCallId}
                approval={approval}
                decision={decisionOf(part)}
                onDecide={approved => onApproval?.(approvalId, approved)}
              />
            );
          return <ToolCall key={part.toolCallId} part={part} />;
        }
        if (part.type === 'data-denied' && !toolIds.has(part.data.toolCallId))
          return <DeniedCall key={`denied-${part.data.toolCallId}`} call={part.data} />;
        if (part.type === 'data-verify') return <VerifyResult key={part.id ?? 'verify'} result={part.data} />;
        if (part.type === 'data-diff') return <DiffView key={part.id ?? 'diff'} diff={part.data.diff} />;
        if (part.type === 'data-checkpoint' && onEvent)
          return <Checkpoint key={part.data.id} checkpoint={part.data} onEvent={onEvent} />;
        return null;
      })}
    </ChatMessage>
  );
}

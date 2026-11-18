import type {ReasoningUIPart, UIMessage} from 'ai';
import * as stylex from '@stylexjs/stylex';
import {ChatMessage, ChatMessageBubble} from '@astryxdesign/core/Chat';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Text} from '@astryxdesign/core/Text';
import {MODELS} from '@/composer/models';
import {ToolCall, type ToolPart} from './ToolCall';

const styles = stylex.create({
  reasoning: {whiteSpace: 'pre-wrap'},
});

const isToolPart = (part: UIMessage['parts'][number]): part is ToolPart =>
  part.type === 'dynamic-tool' || part.type.startsWith('tool-');

function modelLabel(metadata: unknown) {
  const model = (metadata as {model?: unknown} | undefined)?.model;
  return MODELS.find(m => m.value === model)?.label;
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

export function Message({message}: {message: UIMessage}) {
  if (message.role === 'user') {
    const text = message.parts.flatMap(p => (p.type === 'text' ? [p.text] : [])).join('\n');
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble variant="filled">{text}</ChatMessageBubble>
      </ChatMessage>
    );
  }

  const label = modelLabel(message.metadata);
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
        if (isToolPart(part)) return <ToolCall key={part.toolCallId} part={part} />;
        return null;
      })}
    </ChatMessage>
  );
}

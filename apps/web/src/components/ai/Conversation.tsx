import type {ReactNode} from 'react';
import type {AgentMessage, TurnEvent} from '@/lib/agent/types';
import {ChatLayout, ChatMessageList} from '@astryxdesign/core/Chat';
import {Message} from './Message';

type ConversationProps = {
  messages: AgentMessage[];
  isStreaming: boolean;
  composer: ReactNode;
  onApproval?(approvalId: string, approved: boolean): void;
  onEvent?(event: TurnEvent): void;
  children?: ReactNode;
};

export function Conversation({messages, isStreaming, composer, onApproval, onEvent, children}: ConversationProps) {
  return (
    <ChatLayout composer={composer}>
      <ChatMessageList isStreaming={isStreaming}>
        {messages.map(m => (
          <Message key={m.id} message={m} onApproval={onApproval} onEvent={onEvent} />
        ))}
        {children}
      </ChatMessageList>
    </ChatLayout>
  );
}

import type {ReactNode} from 'react';
import type {UIMessage} from 'ai';
import {ChatLayout, ChatMessageList} from '@astryxdesign/core/Chat';
import {Message} from './Message';

type ConversationProps = {
  messages: UIMessage[];
  isStreaming: boolean;
  composer: ReactNode;
};

export function Conversation({messages, isStreaming, composer}: ConversationProps) {
  return (
    <ChatLayout composer={composer}>
      <ChatMessageList isStreaming={isStreaming}>
        {messages.map(m => (
          <Message key={m.id} message={m} />
        ))}
      </ChatMessageList>
    </ChatLayout>
  );
}

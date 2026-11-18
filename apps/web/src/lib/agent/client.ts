import {Chat} from '@ai-sdk/react';
import {DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses} from 'ai';
import type {AgentMessage, ProviderCredential} from './types';

export function createAgentChat({
  getCredential,
  getSandboxId,
  messages,
}: {
  getCredential: () => ProviderCredential | null;
  getSandboxId: () => string | null;
  messages?: AgentMessage[];
}) {
  return new Chat<AgentMessage>({
    messages,
    transport: new DefaultChatTransport<AgentMessage>({
      api: '/api/chat',
      body: () => ({credential: getCredential(), sandboxId: getSandboxId()}),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
}

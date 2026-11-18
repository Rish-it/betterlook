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

async function post(url: string, body: object) {
  const res = await fetch(url, {method: 'POST', body: JSON.stringify(body)});
  if (!res.ok) throw new Error(await res.text());
  return res;
}

export async function restoreCheckpoint(input: {sandboxId: string; checkpointId: string; turnId: string; traceId?: string}): Promise<{headId: string}> {
  return (await post('/api/restore', input)).json();
}

export async function keepTurn(input: {turnId: string; traceId?: string}): Promise<void> {
  await post('/api/events', {type: 'keep', ...input});
}

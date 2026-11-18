import {Chat} from '@ai-sdk/react';
import {type ChatInit, DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses} from 'ai';
import type {ChatGPTStatus} from '@/lib/auth/status';
import {providerOf} from './models';
import type {AgentMessage, ProviderCredential, ProviderId} from './types';

const PROVIDER_NAMES: Record<ProviderId, string> = {anthropic: 'Anthropic', openai: 'OpenAI'};

// OpenAI also works through a ChatGPT sign-in, which only the server holds, so ask it.
async function signedInToChatGPT() {
  const res = await fetch('/api/auth/chatgpt/session', {cache: 'no-store'}).catch(() => null);
  const status: ChatGPTStatus | null = res?.ok ? await res.json() : null;
  return status?.status === 'signed-in' && status.planEnabled;
}

export async function keyNotice(model: string | undefined, getCredential: (provider: ProviderId) => ProviderCredential | null): Promise<string | undefined> {
  const provider = providerOf(model);
  if (!provider || getCredential(provider)) return undefined;
  if (provider === 'openai' && (await signedInToChatGPT())) return undefined;
  return `Add an ${PROVIDER_NAMES[provider]} key to send`;
}

export function createAgentChat({
  getCredential,
  getSandboxId,
  messages,
  onFinish,
}: {
  getCredential: (provider: ProviderId) => ProviderCredential | null;
  getSandboxId: () => string | null;
  messages?: AgentMessage[];
  onFinish?: ChatInit<AgentMessage>['onFinish'];
}) {
  return new Chat<AgentMessage>({
    messages,
    onFinish,
    transport: new DefaultChatTransport<AgentMessage>({
      api: '/api/chat',
      prepareSendMessagesRequest: ({id, messages, body, trigger, messageId}) => {
        const provider = providerOf(body?.model);
        return {body: {...body, id, messages, trigger, messageId, credential: provider && getCredential(provider), sandboxId: getSandboxId()}};
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
}

// Regenerate resends the last user message under its own id, so a retry never appends a second copy.
export async function retry(chat: Chat<AgentMessage>, getCredential: (provider: ProviderId) => ProviderCredential | null) {
  const model = chat.messages.findLast(m => m.role === 'user')?.metadata?.model;
  const notice = await keyNotice(model, getCredential);
  if (!notice) void chat.regenerate({body: {model}});
  return notice;
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

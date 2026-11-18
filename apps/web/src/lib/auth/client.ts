'use client';

import type {ProviderCredential} from '@/lib/agent/types';

let credential: Extract<ProviderCredential, {kind: 'api-key'}> | null = null;

export function setOpenAIApiKey(value: string) {
  const apiKey = value.trim();
  credential = apiKey ? {provider: 'openai', kind: 'api-key', apiKey} : null;
}

export function getCredential(): ProviderCredential | null {
  return credential && {...credential};
}

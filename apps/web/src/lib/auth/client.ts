'use client';

import type {ProviderCredential, ProviderId} from '@/lib/agent/types';

const apiKeys = new Map<ProviderId, string>();

export function setApiKey(provider: ProviderId, value: string) {
  const apiKey = value.trim();
  if (apiKey) apiKeys.set(provider, apiKey);
  else apiKeys.delete(provider);
}

export function getCredential(provider: ProviderId): ProviderCredential | null {
  const apiKey = apiKeys.get(provider);
  return apiKey ? {provider, kind: 'api-key', apiKey} : null;
}

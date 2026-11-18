import {createOpenAI} from '@ai-sdk/openai';
import {MODELS} from './models';
import type {ProviderCredential, ProviderId} from './types';

export function providerOf(modelId: string): ProviderId | null {
  return MODELS.find(m => m.id === modelId)?.provider ?? null;
}

export function languageModel(modelId: string, credential: ProviderCredential) {
  if (providerOf(modelId) !== credential.provider) {
    throw new Error(`Model ${modelId} is not available for provider ${credential.provider}.`);
  }
  const token = credential.kind === 'api-key' ? credential.apiKey : credential.accessToken;
  return createOpenAI({apiKey: token})(modelId);
}

// Body credentials are API keys only; an OAuth token must come from the server-side session cookie.
export function parseCredential(value: unknown): ProviderCredential | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if (c.provider !== 'openai' || c.kind !== 'api-key' || typeof c.apiKey !== 'string' || !c.apiKey) return null;
  return {provider: c.provider, kind: c.kind, apiKey: c.apiKey};
}

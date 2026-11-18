import {createOpenAI} from '@ai-sdk/openai';
import type {ProviderCredential, ProviderId} from './types';

export function providerOf(modelId: string): ProviderId | null {
  return modelId.startsWith('gpt-') ? 'openai' : null;
}

export function languageModel(modelId: string, credential: ProviderCredential) {
  if (providerOf(modelId) !== credential.provider) {
    throw new Error(`Model ${modelId} is not available for provider ${credential.provider}.`);
  }
  const token = credential.kind === 'api-key' ? credential.apiKey : credential.accessToken;
  return createOpenAI({apiKey: token})(modelId);
}

export function parseCredential(value: unknown): ProviderCredential | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if (c.provider !== 'openai') return null;
  if (c.kind === 'api-key' && typeof c.apiKey === 'string' && c.apiKey) {
    return {provider: c.provider, kind: c.kind, apiKey: c.apiKey};
  }
  if (c.kind === 'oauth' && typeof c.accessToken === 'string' && c.accessToken) {
    const expiresAt = typeof c.expiresAt === 'number' ? c.expiresAt : undefined;
    return {provider: c.provider, kind: c.kind, accessToken: c.accessToken, expiresAt};
  }
  return null;
}

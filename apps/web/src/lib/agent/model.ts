import {createAnthropic} from '@ai-sdk/anthropic';
import {createOpenAI} from '@ai-sdk/openai';
import {providerOf} from './models';
import type {ProviderCredential} from './types';

export function languageModel(modelId: string, credential: ProviderCredential) {
  if (providerOf(modelId) !== credential.provider) {
    throw new Error(`Model ${modelId} is not available for provider ${credential.provider}.`);
  }
  if (credential.provider === 'anthropic') {
    if (credential.kind !== 'api-key') throw new Error('Anthropic accepts API keys only.');
    return createAnthropic({apiKey: credential.apiKey})(modelId);
  }
  const token = credential.kind === 'api-key' ? credential.apiKey : credential.accessToken;
  return createOpenAI({apiKey: token})(modelId);
}

// Body credentials are API keys only; an OAuth token must come from the server-side session cookie.
export function parseCredential(value: unknown): ProviderCredential | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if ((c.provider !== 'openai' && c.provider !== 'anthropic') || c.kind !== 'api-key' || typeof c.apiKey !== 'string' || !c.apiKey) return null;
  return {provider: c.provider, kind: c.kind, apiKey: c.apiKey};
}

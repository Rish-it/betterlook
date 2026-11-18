import type {ProviderId} from './types';

export const MODELS: {id: string; label: string; provider: ProviderId}[] = [
  {id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic'},
  {id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai'},
  {id: 'gpt-5', label: 'GPT-5', provider: 'openai'},
];

export function providerOf(modelId: string | undefined): ProviderId | null {
  return MODELS.find(m => m.id === modelId)?.provider ?? null;
}

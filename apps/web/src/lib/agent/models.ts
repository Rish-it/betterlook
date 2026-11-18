import type {ProviderId} from './types';

export const MODELS: {id: string; label: string; provider: ProviderId}[] = [
  {id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai'},
  {id: 'gpt-5', label: 'GPT-5', provider: 'openai'},
];

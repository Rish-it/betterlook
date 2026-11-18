import type {ProviderCredential} from '@/lib/agent/types';
import {getChatGPTAuth} from './chatgpt';

export async function getServerCredential(request: Request): Promise<ProviderCredential | null> {
  const tokens = await getChatGPTAuth()?.tokens(request);
  if (!tokens) return null;
  const {accessToken, expiresAt} = tokens;
  return {provider: 'openai', kind: 'oauth', accessToken, expiresAt};
}

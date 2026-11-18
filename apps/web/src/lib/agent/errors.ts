import {APICallError} from 'ai';

export const KEY_REJECTED = 'Your API key or sign-in was rejected. Check it and try again.';
export const PROVIDER_FAILED = 'The model provider returned an error. Try again.';

// Never forward provider text: OpenAI's 401 body echoes part of the key.
export function userMessage(error: unknown): string {
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  return status === 401 || status === 403 ? KEY_REJECTED : PROVIDER_FAILED;
}

export function errorStatus(error: unknown): number | string {
  return APICallError.isInstance(error) ? (error.statusCode ?? 'no-status') : error instanceof Error ? error.name : 'unknown';
}

import {APICallError} from 'ai';

export const KEY_REJECTED = 'Your API key or sign-in was rejected. Check it and try again.';
export const RATE_LIMITED = 'The model provider is rate limiting requests. Wait a minute and try again.';
export const PROVIDER_FAILED = 'The model provider returned an error. Try again.';
export const VERIFY_FAILED = 'The change still fails its checks after one repair attempt. Restore the previous version or describe what to fix.';
export const STEP_LIMIT = 'The agent hit its step limit before finishing. Send another message to let it continue.';
export const SANDBOX_FAILED = 'The preview sandbox stopped responding. Reload to try again.';

// The SDK wraps errors it retried; the provider's status is on the last attempt.
const apiError = (error: unknown) => {
  const last = (error as {lastError?: unknown} | null)?.lastError ?? error;
  return APICallError.isInstance(last) ? last : null;
};

// Never forward provider text: OpenAI's 401 body echoes part of the key.
export function userMessage(error: unknown): string {
  const status = apiError(error)?.statusCode;
  if (status === 401 || status === 403) return KEY_REJECTED;
  if (status === 429) return RATE_LIMITED;
  return PROVIDER_FAILED;
}

export function errorStatus(error: unknown): number | string {
  const api = apiError(error);
  return api ? (api.statusCode ?? 'no-status') : error instanceof Error ? error.name : 'unknown';
}

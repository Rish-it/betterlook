import {randomBytes} from 'node:crypto';
import {createOpenAIClient, OpenAIAuthError, type OpenAIConfig} from './openai';
import {createSessionStorage, type StoredSession} from './session';
import type {ChatGPTIssue, ChatGPTStatus} from './status';

const responseHeaders = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'};
const refreshMargin = 60 * 1000;

type ChatGPTConfig = OpenAIConfig & {cookieKey: Buffer};

function readConfig(): ChatGPTConfig | null {
  const clientId = process.env.OPENAI_SIWC_CLIENT_ID;
  const clientSecret = process.env.OPENAI_SIWC_CLIENT_SECRET;
  const redirectUri = process.env.OPENAI_SIWC_REDIRECT_URI;
  const planScopes = [...new Set(process.env.OPENAI_SIWC_PLAN_SCOPES?.trim().split(/\s+/).filter(Boolean))];
  const resource = process.env.OPENAI_SIWC_RESOURCE;
  const key = process.env.BETTERLOOK_AUTH_COOKIE_KEY;
  if (!clientId || !redirectUri || !key || !/^[A-Za-z0-9_-]{43}$/.test(key) ||
      !planScopes.some(scope => !['openid', 'profile', 'email', 'offline_access'].includes(scope))) {
    return null;
  }

  try {
    const redirect = new URL(redirectUri);
    const local = process.env.NODE_ENV !== 'production' && redirect.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (
      (!local && redirect.protocol !== 'https:') || redirect.username || redirect.password ||
      redirect.search || redirect.hash || redirect.pathname !== '/api/auth/chatgpt/callback'
    ) return null;
  } catch {
    return null;
  }

  return {clientId, clientSecret, redirectUri, planScopes, resource, cookieKey: Buffer.from(key, 'base64url')};
}

function workspace(issue?: ChatGPTIssue, cookies: string[] = []) {
  const headers = new Headers(responseHeaders);
  headers.set('Location', issue ? `/workspace?chatgpt=${issue}` : '/workspace');
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, {status: 303, headers});
}

function json(value: ChatGPTStatus, cookies: string[] = []) {
  const headers = new Headers(responseHeaders);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return Response.json(value, {headers});
}

export function createChatGPTAuth(config: ChatGPTConfig, fetcher: typeof fetch, now = Date.now) {
  const origin = new URL(config.redirectUri).origin;
  const storage = createSessionStorage(config.cookieKey, origin.startsWith('https:'), now);
  const openai = createOpenAIClient(config, fetcher, now);

  async function refresh(session: StoredSession, tokens: NonNullable<StoredSession['tokens']>) {
    try {
      session.tokens = await openai.refresh(tokens);
      session.issue = undefined;
      session.retryAfter = undefined;
    } catch (error) {
      session.issue = error instanceof OpenAIAuthError ? error.issue : 'refresh-failed';
      if (session.issue === 'provider-unavailable') {
        session.retryAfter = now() + 5000;
      } else if (session.issue !== 'refresh-failed') {
        session.tokens = null;
      }
    }
  }

  async function activeSession(request: Request) {
    const {session, hadSession} = storage.session(request);
    if (!session) return {session: null, hadSession};
    const tokens = session.tokens;
    if (tokens && session.issue !== 'refresh-failed' && tokens.expiresAt <= now() + refreshMargin) {
      if (!tokens.refreshToken) {
        if (tokens.expiresAt <= now()) {
          session.tokens = null;
          session.issue = 'expired';
        }
      } else if (now() >= Math.max(tokens.refreshAfter ?? 0, session.retryAfter ?? 0)) {
        session.refresh ??= refresh(session, tokens).finally(() => {
          session.refresh = undefined;
        });
        await session.refresh;
      }
    }
    if (session.closed || session.expiresAt <= now()) return {session: null, hadSession};
    return {session, hadSession};
  }

  function usableTokens(session: StoredSession | null) {
    const tokens = session?.tokens;
    return tokens && session?.issue !== 'refresh-failed' && tokens.expiresAt > now() ? tokens : null;
  }

  return {
    async start(request: Request) {
      if (request.headers.get('origin') !== origin) return new Response(null, {status: 403});
      const current = storage.session(request).session;
      if (usableTokens(current ?? null)) return workspace();
      const transaction = {
        state: randomBytes(32).toString('base64url'),
        nonce: randomBytes(32).toString('base64url'),
        verifier: randomBytes(32).toString('base64url'),
      };
      try {
        const authorization = await openai.authorizationUrl(transaction);
        const headers = new Headers(responseHeaders);
        headers.set('Location', authorization.href);
        headers.set('Set-Cookie', storage.start(request, transaction));
        return new Response(null, {status: 303, headers});
      } catch {
        return workspace('provider-unavailable');
      }
    },

    async callback(request: Request) {
      const params = new URL(request.url).searchParams;
      const transaction = storage.consume(request);
      const cookies = [storage.clearTransaction];
      if (
        !transaction || params.getAll('state').length !== 1 ||
        params.get('state') !== transaction.state ||
        (params.has('iss') && params.get('iss') !== 'https://auth.openai.com') ||
        (params.has('client_id') && params.get('client_id') !== config.clientId)
      ) return workspace('sign-in-failed', cookies);

      if (params.has('error')) {
        return workspace(params.get('error') === 'access_denied' ? 'consent-denied' : 'sign-in-failed', cookies);
      }
      const code = params.get('code');
      if (!code || params.getAll('code').length !== 1) return workspace('sign-in-failed', cookies);

      try {
        const session = await openai.exchange(code, transaction);
        storage.disconnect(request);
        cookies.push(storage.connect(session));
        return workspace(undefined, cookies);
      } catch (error) {
        return workspace(error instanceof OpenAIAuthError ? error.issue : 'sign-in-failed', cookies);
      }
    },

    async status(request: Request) {
      const {session, hadSession} = await activeSession(request);
      if (!session) return json(
        {status: 'signed-out', available: true, issue: hadSession ? 'expired' : undefined},
        hadSession ? [storage.clearSession] : [],
      );
      const planEnabled = Boolean(usableTokens(session));
      return json({
        status: 'signed-in',
        account: session.account,
        planEnabled,
        issue: session.issue ?? (!planEnabled ? 'expired' : undefined),
      });
    },

    async signOut(request: Request) {
      if (request.headers.get('origin') !== origin) return new Response(null, {status: 403});
      storage.consume(request);
      const session = storage.disconnect(request);
      await session?.refresh;
      const revoked = await openai.revoke(session?.tokens ?? null);
      return json({
        status: 'signed-out',
        available: true,
        issue: revoked ? undefined : 'revocation-unconfirmed',
      }, [storage.clearSession, storage.clearTransaction]);
    },

    async tokens(request: Request) {
      if (request.headers.get('origin') !== origin) return null;
      return usableTokens((await activeSession(request)).session);
    },
  };
}

const runtime = globalThis as typeof globalThis & {
  betterlookChatGPTAuth?: ReturnType<typeof createChatGPTAuth>;
};

export function getChatGPTAuth() {
  if (runtime.betterlookChatGPTAuth) return runtime.betterlookChatGPTAuth;
  const config = readConfig();
  if (!config) return null;
  return runtime.betterlookChatGPTAuth = createChatGPTAuth(config, fetch);
}

export function unavailableRedirect() {
  return workspace('not-configured');
}

export function unavailableStatus() {
  return json({status: 'signed-out', available: false});
}

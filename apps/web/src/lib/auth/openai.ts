import {createHash, createPublicKey, verify} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {ChatGPTIssue} from './status';

const issuer = 'https://auth.openai.com';
const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
const identityScopes = ['openid', 'profile', 'email'];
const unusableRefresh = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

export type OpenAIConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  planScopes: string[];
  resource?: string;
};

type SessionTokens = {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshAfter?: number;
  scopes: Set<string>;
};

export type OpenAISession = {
  account: string;
  tokens: SessionTokens | null;
  issue?: ChatGPTIssue;
};

export type Authorization = {state: string; nonce: string; verifier: string};

export class OpenAIAuthError extends Error {
  constructor(readonly issue: ChatGPTIssue) {
    super(issue);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenAIAuthError('sign-in-failed');
  }
  return value as Record<string, unknown>;
}

function jwtRecord(part: string) {
  return record(JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
}

function providerEndpoint(value: unknown) {
  if (typeof value !== 'string') throw new OpenAIAuthError('provider-unavailable');
  const url = new URL(value);
  if (url.origin !== issuer || url.username || url.password || url.hash) {
    throw new OpenAIAuthError('provider-unavailable');
  }
  return url.href;
}

function verifyIdentity(
  token: unknown,
  keys: unknown,
  clientId: string,
  nonce: string,
  accessToken: unknown,
  now: number,
) {
  if (typeof token !== 'string' || token.length > 16_384 || !Array.isArray(keys)) {
    throw new OpenAIAuthError('sign-in-failed');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new OpenAIAuthError('sign-in-failed');
  }
  const [header, payload, signature] = parts;
  const {alg, kid, crit} = jwtRecord(header);
  if (alg !== 'RS256' || typeof kid !== 'string' || !kid || crit !== undefined) {
    throw new OpenAIAuthError('sign-in-failed');
  }
  const key = keys.map(record).find(candidate =>
    candidate.kid === kid && candidate.kty === 'RSA' &&
    (candidate.alg === undefined || candidate.alg === 'RS256') &&
    (candidate.use === undefined || candidate.use === 'sig'),
  );
  if (!key || !verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    createPublicKey({key, format: 'jwk'}),
    Buffer.from(signature, 'base64url'),
  )) {
    throw new OpenAIAuthError('sign-in-failed');
  }

  const claims = jwtRecord(payload);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const nowSeconds = now / 1000;
  if (
    claims.iss !== issuer || !audience.includes(clientId) ||
    ((audience.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) ||
    claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub.trim() ||
    typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds - 5 ||
    typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > nowSeconds + 5 ||
    (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > nowSeconds + 5))
  ) {
    throw new OpenAIAuthError('sign-in-failed');
  }
  if (claims.at_hash !== undefined) {
    const hash = typeof accessToken === 'string'
      ? createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url')
      : null;
    if (!hash || claims.at_hash !== hash) throw new OpenAIAuthError('sign-in-failed');
  }

  const name = typeof claims.name === 'string' ? claims.name.trim() : '';
  const email = claims.email_verified === true && typeof claims.email === 'string'
    ? claims.email.trim()
    : '';
  return (name || email || 'ChatGPT account').slice(0, 160);
}

export function createOpenAIClient(config: OpenAIConfig, fetcher: typeof fetch, now: () => number) {
  const requiredScopes = config.planScopes.filter(scope => scope !== 'offline_access');
  let metadata: ReturnType<typeof discover> | undefined;

  async function request(url: string, init?: RequestInit) {
    try {
      return await fetcher(url, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new OpenAIAuthError('provider-unavailable');
    }
  }

  async function discover() {
    const response = await request(discoveryUrl);
    if (!response.ok) throw new OpenAIAuthError('provider-unavailable');
    const data = record(await response.json());
    if (data.issuer !== issuer) throw new OpenAIAuthError('provider-unavailable');
    return {
      authorization: providerEndpoint(data.authorization_endpoint),
      token: providerEndpoint(data.token_endpoint),
      revocation: providerEndpoint(data.revocation_endpoint),
      jwks: providerEndpoint(data.jwks_uri),
    };
  }

  function endpoints() {
    metadata ??= discover().catch(() => {
      metadata = undefined;
      throw new OpenAIAuthError('provider-unavailable');
    });
    return metadata;
  }

  async function post(url: string, body: URLSearchParams) {
    body.set('client_id', config.clientId);
    const headers = new Headers({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    });
    if (config.clientSecret) {
      const encoded = new URLSearchParams([[config.clientId, config.clientSecret]])
        .toString().replace('=', ':');
      headers.set('authorization', `Basic ${Buffer.from(encoded).toString('base64')}`);
    }
    return request(url, {method: 'POST', body, headers});
  }

  function tokenFields(data: Record<string, unknown>, previous?: SessionTokens): SessionTokens | null {
    const scopes = typeof data.scope === 'string'
      ? new Set(data.scope.split(/\s+/))
      : previous?.scopes ?? new Set<string>();
    if (!requiredScopes.every(scope => scopes.has(scope))) return null;

    const {access_token, token_type, expires_in, refresh_token, earliest_refresh_at} = data;
    if (
      typeof access_token !== 'string' || !access_token ||
      typeof token_type !== 'string' || token_type.toLowerCase() !== 'bearer' ||
      typeof expires_in !== 'number' || !Number.isSafeInteger(expires_in) || expires_in <= 0
    ) {
      throw new OpenAIAuthError(previous ? 'refresh-failed' : 'sign-in-failed');
    }
    return {
      accessToken: access_token,
      expiresAt: now() + expires_in * 1000,
      refreshToken: typeof refresh_token === 'string' && refresh_token
        ? refresh_token
        : previous?.refreshToken,
      refreshAfter: typeof earliest_refresh_at === 'number' && Number.isFinite(earliest_refresh_at)
        ? earliest_refresh_at * 1000
        : undefined,
      scopes,
    };
  }

  return {
    async authorizationUrl({state, nonce, verifier}: Authorization) {
      const url = new URL((await endpoints()).authorization);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: [...new Set([...identityScopes, ...config.planScopes])].join(' '),
        state,
        nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      if (config.resource) url.searchParams.set('resource', config.resource);
      return url;
    },

    async exchange(code: string, {nonce, verifier}: Authorization): Promise<OpenAISession> {
      const {token, jwks} = await endpoints();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
      });
      if (config.resource) body.set('resource', config.resource);
      const response = await post(token, body);
      if (!response.ok) {
        throw new OpenAIAuthError(response.status >= 500 || response.status === 429
          ? 'provider-unavailable'
          : 'sign-in-failed');
      }
      const data = record(await response.json());
      const jwksResponse = await request(jwks);
      if (!jwksResponse.ok) throw new OpenAIAuthError('provider-unavailable');
      const {keys} = record(await jwksResponse.json());
      const account = verifyIdentity(data.id_token, keys, config.clientId, nonce, data.access_token, now());
      const tokens = tokenFields(data);
      return {account, tokens, issue: tokens ? undefined : 'consent-denied'};
    },

    async refresh(tokens: SessionTokens): Promise<SessionTokens> {
      if (!tokens.refreshToken) throw new OpenAIAuthError('expired');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      });
      if (config.resource) body.set('resource', config.resource);
      const response = await post((await endpoints()).token, body);
      if (response.status >= 500 || response.status === 429) {
        throw new OpenAIAuthError('provider-unavailable');
      }
      try {
        const data = record(await response.json());
        if (!response.ok) {
          if (data.error === 'token_expired' || data.error === 'refresh_token_expired') {
            throw new OpenAIAuthError('expired');
          }
          if (typeof data.error === 'string' && unusableRefresh.has(data.error)) {
            throw new OpenAIAuthError('revoked');
          }
          throw new OpenAIAuthError('refresh-failed');
        }
        const refreshed = tokenFields(data, tokens);
        if (!refreshed) throw new OpenAIAuthError('revoked');
        return refreshed;
      } catch (error) {
        if (error instanceof OpenAIAuthError && error.issue !== 'sign-in-failed') throw error;
        throw new OpenAIAuthError('refresh-failed');
      }
    },

    async revoke(tokens: SessionTokens | null) {
      if (!tokens) return true;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await post((await endpoints()).revocation, new URLSearchParams({
            token: tokens.refreshToken ?? tokens.accessToken,
            token_type_hint: tokens.refreshToken ? 'refresh_token' : 'access_token',
          }));
          if (response.ok) return true;
          if (response.status < 500 && response.status !== 429) return false;
        } catch {
          // Retry a temporary failure while we still have the token.
        }
        if (attempt === 0) await delay(250);
      }
      return false;
    },
  };
}

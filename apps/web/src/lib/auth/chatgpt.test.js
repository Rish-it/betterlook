import {describe, expect, test} from 'bun:test';
import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {createChatGPTAuth} from './chatgpt';

const issuer = 'https://auth.openai.com';
const origin = 'https://editor.example';
const redirectUri = `${origin}/api/auth/chatgpt/callback`;
const clientId = 'oaiapp_mock';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const jwk = {...publicKey.export({format: 'jwk'}), kid: 'test-signing-key'};
const signingHeader = Buffer.from(JSON.stringify({alg: 'RS256', kid: jwk.kid})).toString('base64url');
const random = () => randomBytes(32).toString('base64url');

function signedToken(claims, signatureValid = true) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${signingHeader}.${body}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  if (!signatureValid) signature[0] ^= 1;
  return `${signingInput}.${signature.toString('base64url')}`;
}

function scenario(overrides = {}) {
  let now = Date.now();
  const accessToken = random();
  const refreshToken = random();
  const nextAccessToken = random();
  const nextRefreshToken = random();
  const calls = {exchange: [], refresh: [], revoke: []};
  const config = {
    clientId,
    redirectUri,
    cookieKey: randomBytes(32),
    planScopes: ['offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
    resource: 'https://api.openai.com/v1',
    ...overrides.config,
  };

  const auth = createChatGPTAuth(config, async (url, init) => {
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        revocation_endpoint: `${issuer}/revoke`,
      });
    }
    if (url === `${issuer}/jwks`) return Response.json({keys: [jwk]});
    if (url === `${issuer}/revoke`) {
      calls.revoke.push(init.body);
      return overrides.revoke?.() ?? new Response(null, {status: 200});
    }
    if (url !== `${issuer}/token`) throw new Error('Unexpected mock endpoint.');

    const grant = init.body.get('grant_type');
    if (grant === 'refresh_token') {
      calls.refresh.push(init.body);
      const refreshResponse = await overrides.refresh?.();
      return refreshResponse ?? Response.json({
        token_type: 'Bearer',
        expires_in: 3600,
        access_token: nextAccessToken,
        refresh_token: nextRefreshToken,
      });
    }
    if (grant !== 'authorization_code') throw new Error('Unexpected mock grant.');

    calls.exchange.push(init);
    const idToken = signedToken({
      iss: issuer,
      aud: clientId,
      sub: 'mock-subject',
      nonce: init.body.get('code'),
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
      at_hash: createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url'),
      name: 'Demo account',
      ...overrides.claims,
    }, overrides.signatureValid);
    return Response.json({
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: scopes,
      access_token: accessToken,
      refresh_token: refreshToken,
      ...overrides.tokenResponse,
    });
  }, () => now);

  function incoming(path, cookie, method = 'GET', requestOrigin = origin) {
    const headers = new Headers({origin: requestOrigin});
    if (cookie) headers.set('cookie', cookie);
    return new Request(new URL(path, origin), {method, headers});
  }

  async function start() {
    const response = await auth.start(incoming('/api/auth/chatgpt/start', null, 'POST'));
    const authorization = new URL(response.headers.get('location'));
    const cookie = response.headers.get('set-cookie');
    return {authorization, cookie, header: cookie.split(';')[0]};
  }

  function callback({authorization, header}, changes = {}) {
    const args = new URLSearchParams({
      state: authorization.searchParams.get('state'),
      code: authorization.searchParams.get('nonce'),
      ...changes,
    });
    if (changes.state === null) args.delete('state');
    return auth.callback(incoming(`${redirectUri}?${args}`, header));
  }

  async function connect() {
    const started = await start();
    const response = await callback(started);
    const cookies = response.headers.getSetCookie();
    const header = cookies.find(cookie => cookie.startsWith('__Host-betterlook-chatgpt=')).split(';')[0];
    return {started, response, header, cookies};
  }

  return {
    auth, incoming, start, callback, connect, calls, accessToken, refreshToken, nextAccessToken,
    nextRefreshToken, passTime: elapsed => { now += elapsed; },
    request: header => incoming('/api/auth/chatgpt/session', header),
    signOut: header => auth.signOut(incoming('/api/auth/chatgpt/session', header, 'POST')),
  };
}

describe('ChatGPT authorization', () => {
  test('binds single-use state, nonce and S256 PKCE to a secure browser session', async () => {
    const flow = scenario();
    const {started, response, header, cookies} = await flow.connect();
    const send = flow.calls.exchange[0];
    const verifier = send.body.get('code_verifier');
    const {searchParams} = started.authorization;
    expect(started.authorization.origin).toBe(issuer);
    expect(searchParams.get('code_challenge_method')).toBe('S256');
    expect(searchParams.get('code_challenge') === createHash('sha256').update(verifier).digest('base64url')).toBe(true);
    expect(searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(searchParams.get('scope')).toBe(scopes);
    expect(searchParams.has('id_token_hint')).toBe(false);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(send.body.get('redirect_uri')).toBe(redirectUri);
    expect(send.body.get('client_id')).toBe(clientId);
    expect(send.headers.has('authorization')).toBe(false);
    expect(response.headers.get('location')).toBe('/workspace');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cookies[0]).toContain('Max-Age=0');
    expect(cookies[1]).toContain('Path=/; HttpOnly; SameSite=Lax; Secure');
    expect(/Max-Age|Expires/.test(cookies[1])).toBe(false);
    expect(cookies.some(cookie => cookie.includes(flow.accessToken) || cookie.includes(flow.refreshToken))).toBe(false);
    expect(await (await flow.auth.status(flow.request(header))).json()).toEqual({
      status: 'signed-in', account: 'Demo account', planEnabled: true,
    });
    expect((await flow.callback(started)).headers.get('location')).toBe('/workspace?chatgpt=sign-in-failed');
    expect(flow.calls.exchange).toHaveLength(1);
  });

  test('uses the provisioned confidential-client authentication method', async () => {
    const clientSecret = random();
    const flow = scenario({config: {clientSecret}});
    await flow.connect();
    const exchange = flow.calls.exchange[0];
    const expected = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    expect(exchange.headers.get('authorization') === `Basic ${expected}`).toBe(true);
    expect(exchange.body.has('client_secret')).toBe(false);
  });

  test('rejects missing, mismatched, expired and stolen state before the exchange', async () => {
    const flow = scenario();
    const missing = await flow.start();
    const mismatch = await flow.start();
    const expired = await flow.start();
    const deniedResponses = await Promise.all([
      flow.callback(missing, {state: null}),
      flow.callback(mismatch, {state: 'unrelated-state'}),
      flow.callback({...mismatch, header: undefined}),
    ]);
    flow.passTime(10 * 60_000);
    deniedResponses.push(await flow.callback(expired));
    expect(deniedResponses.every(response =>
      response.headers.get('location') === '/workspace?chatgpt=sign-in-failed',
    )).toBe(true);
    expect(flow.calls.exchange).toHaveLength(0);
  });

  test('only one concurrent callback can redeem a transaction', async () => {
    const flow = scenario();
    const started = await flow.start();
    const responses = await Promise.all([flow.callback(started), flow.callback(started)]);
    expect(responses.map(response => response.headers.get('location')).sort()).toEqual([
      '/workspace', '/workspace?chatgpt=sign-in-failed',
    ]);
    expect(flow.calls.exchange).toHaveLength(1);
  });

  test.each([
    ['nonce', {claims: {nonce: 'other-attempt'}}],
    ['issuer', {claims: {iss: 'https://other.example'}}],
    ['audience', {claims: {aud: 'other-app'}}],
    ['expiry', {claims: {exp: 0}}],
    ['signature', {signatureValid: false}],
    ['access-token hash', {claims: {at_hash: 'other-access'}}],
  ])('rejects an invalid %s', async (_name, options) => {
    const flow = scenario(options);
    const started = await flow.start();
    const response = await flow.callback(started);
    expect(response.headers.get('location')).toBe('/workspace?chatgpt=sign-in-failed');
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  test('handles denied consent with or without an identity grant', async () => {
    const flow = scenario({tokenResponse: {scope: 'openid profile email'}});
    const started = await flow.start();
    const denied = await flow.callback(started, {error: 'access_denied'});
    expect(denied.headers.get('location')).toBe('/workspace?chatgpt=consent-denied');
    expect(flow.calls.exchange).toHaveLength(0);

    const {header} = await flow.connect();
    const request = flow.request(header);
    expect(await (await flow.auth.status(request)).json()).toEqual({
      status: 'signed-in', account: 'Demo account', planEnabled: false, issue: 'consent-denied',
    });
    expect(await flow.auth.tokens(request)).toBeNull();
  });

  test('rejects cross-origin authorization and sign-out posts', async () => {
    const flow = scenario();
    const {header} = await flow.connect();
    const request = flow.incoming('/api/auth/chatgpt/start', header, 'POST', 'https://other.example');
    expect((await flow.auth.start(request)).status).toBe(403);
    expect((await flow.auth.signOut(request)).status).toBe(403);
    expect(await flow.auth.tokens(request)).toBeNull();
  });
});

describe('ChatGPT session renewal and sign-out', () => {
  test('serializes refresh and reuses the rotated grant for every request', async () => {
    const flow = scenario();
    const {header} = await flow.connect();
    const request = flow.request(header);
    expect((await flow.auth.tokens(request)).accessToken === flow.accessToken).toBe(true);
    expect(flow.calls.refresh).toHaveLength(0);

    flow.passTime(59 * 60_000);
    const credentials = await Promise.all([
      flow.auth.tokens(request), flow.auth.tokens(request), flow.auth.tokens(request),
    ]);
    expect(flow.calls.refresh).toHaveLength(1);
    expect(flow.calls.refresh[0].get('refresh_token') === flow.refreshToken).toBe(true);
    expect(flow.calls.refresh[0].has('scope')).toBe(false);
    expect(credentials.every(tokens => tokens.accessToken === flow.nextAccessToken)).toBe(true);

    flow.passTime(59 * 60_000);
    await flow.auth.tokens(request);
    expect(flow.calls.refresh).toHaveLength(2);
    expect(flow.calls.refresh[1].get('refresh_token') === flow.nextRefreshToken).toBe(true);
  });

  test('sign-out prevents further use and revokes the grant rotated during sign-out', async () => {
    let finishRefresh;
    let refreshStarted;
    const refreshing = new Promise(resolve => { refreshStarted = resolve; });
    const finish = new Promise(resolve => { finishRefresh = resolve; });
    const flow = scenario({refresh: async () => {
      refreshStarted();
      await finish;
    }});
    const {header} = await flow.connect();
    const request = flow.request(header);
    flow.passTime(59 * 60_000);
    const credential = flow.auth.tokens(request);
    await refreshing;
    const signingOut = flow.signOut(header);
    finishRefresh();
    const signedOut = await signingOut;

    expect(await credential).toBeNull();
    expect(await flow.auth.tokens(request)).toBeNull();
    expect(flow.calls.revoke).toHaveLength(1);
    expect(flow.calls.revoke[0].get('token') === flow.nextRefreshToken).toBe(true);
    expect(flow.calls.revoke[0].get('token_type_hint')).toBe('refresh_token');
    expect(signedOut.headers.getSetCookie().every(cookie => cookie.includes('Max-Age=0'))).toBe(true);
    expect((await signedOut.json()).status).toBe('signed-out');
  });

  test('expires a grant without renewal and enforces the server session lifetime', async () => {
    const flow = scenario({tokenResponse: {refresh_token: undefined}});
    const {header} = await flow.connect();
    const request = flow.request(header);
    flow.passTime(3600_000);
    expect(await flow.auth.tokens(request)).toBeNull();
    expect((await (await flow.auth.status(request)).json()).issue).toBe('expired');
    expect(flow.calls.refresh).toHaveLength(0);

    flow.passTime(7 * 3600_000);
    const expired = await flow.auth.status(request);
    expect(await expired.json()).toEqual({status: 'signed-out', available: true, issue: 'expired'});
    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test.each([
    ['revoked', 400, {error: 'invalid_grant'}],
    ['expired', 400, {error: 'refresh_token_expired'}],
    ['refresh-failed', 200, {token_type: 'Bearer'}],
    ['provider-unavailable', 503, {error: 'temporarily_unavailable'}],
  ])('surfaces %s without exposing the provider response', async (issue, status, body) => {
    const flow = scenario({refresh: () => Response.json(body, {status})});
    const {header} = await flow.connect();
    flow.passTime(3600_000);
    const request = flow.request(header);
    expect(await flow.auth.tokens(request)).toBeNull();
    expect(await (await flow.auth.status(request)).json()).toEqual({
      status: 'signed-in', account: 'Demo account', planEnabled: false, issue,
    });
    expect(flow.calls.refresh).toHaveLength(1);
  });

  test('retries a temporary outage on a later request', async () => {
    let attempts = 0;
    const flow = scenario({refresh: () => {
      attempts++;
      if (attempts === 1) return new Response(null, {status: 503});
    }});
    const {header} = await flow.connect();
    const request = flow.request(header);
    flow.passTime(3600_000);
    expect(await flow.auth.tokens(request)).toBeNull();
    flow.passTime(5000);
    expect((await flow.auth.tokens(request)).accessToken === flow.nextAccessToken).toBe(true);
  });

  test('ends the local session when provider revocation could not be confirmed', async () => {
    const flow = scenario({revoke: () => new Response(null, {status: 503})});
    const {header} = await flow.connect();
    const signedOut = await flow.signOut(header);
    expect(await signedOut.json()).toEqual({
      status: 'signed-out', available: true, issue: 'revocation-unconfirmed',
    });
    expect(flow.calls.revoke).toHaveLength(2);
    expect(await flow.auth.tokens(flow.request(header))).toBeNull();
  });

  test('rejects a tampered session cookie', async () => {
    const flow = scenario();
    const {header} = await flow.connect();
    const tampered = header.slice(0, -1) + (header.endsWith('A') ? 'B' : 'A');
    expect(await flow.auth.tokens(flow.request(tampered))).toBeNull();
  });
});

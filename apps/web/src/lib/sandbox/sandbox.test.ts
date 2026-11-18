/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {POST} from '@/app/api/sandbox/route';
import {SANDBOX_CONFIG} from '@/lib/agent/config';
import {BASE_NAME, connectSandbox, createSandbox, openProject} from './sandbox';
import {PREVIEW_PORT, STARTER_FILES} from './starter';

const STARTER_SETUP = [
  `write ${Object.keys(STARTER_FILES).sort().join(',')}`,
  'npm install --no-audit --no-fund',
  'git init -q',
  'git config user.name Betterlook',
  'git config user.email agent@betterlook.invalid',
  'git add -A',
  'git commit -q -m starter',
  'mkdir /tmp/betterlook',
  'write /tmp/betterlook/check.mjs',
  'npm install --prefix /tmp/betterlook --no-audit --no-fund playwright@1.58.0',
  'sudo npx --prefix /tmp/betterlook playwright install --with-deps chromium',
];

function fakeApi({failOn, snapshots = [], expiresInMs = SANDBOX_CONFIG.timeoutMs}: {failOn?: string; snapshots?: {id: string; status: string}[]; expiresInMs?: number} = {}) {
  const calls: string[] = [];
  const sandbox = {
    name: 'sbx-test',
    cwd: '/vercel/sandbox',
    expiresAt: new Date(Date.now() + expiresInMs),
    domain: (port: number) => `https://sbx-test-${port}.example`,
    writeFiles: async (files: {path: string}[]) => void calls.push(`write ${files.map(f => f.path).sort().join(',')}`),
    mkDir: async (path: string) => void calls.push(`mkdir ${path}`),
    runCommand: async (cmdOrParams: string | {cmd: string; args: string[]; detached?: boolean; sudo?: boolean}, args: string[] = []) => {
      const line =
        typeof cmdOrParams === 'string'
          ? `${cmdOrParams} ${args.join(' ')}`
          : `${cmdOrParams.sudo ? 'sudo ' : ''}${cmdOrParams.cmd} ${cmdOrParams.args.join(' ')}${cmdOrParams.detached ? ' &' : ''}`;
      calls.push(line);
      return {exitCode: failOn && line.startsWith(failOn) ? 1 : 0};
    },
    snapshot: async (opts: unknown) => (calls.push(`snapshot ${JSON.stringify(opts)}`), {snapshotId: 'snap-base'}),
    extendTimeout: async (ms: number) => void calls.push(`extend ${Math.round(ms / 60_000)}m`),
    stop: async () => (calls.push('stop'), {vcpus: 2, activeCpuDurationMs: 4200, startedAt: 1_000, stoppedAt: 61_000}),
  };
  const api = {
    Sandbox: {
      create: async (params: unknown) => (calls.push(`create ${JSON.stringify(params)}`), sandbox),
      getOrCreate: async (params: unknown) => (calls.push(`getOrCreate ${JSON.stringify(params)}`), sandbox),
      get: async (params: {name: string; resume: boolean; onResume: (s: typeof sandbox) => Promise<void>}) => {
        calls.push(`get ${params.name} resume=${params.resume}`);
        await params.onResume(sandbox);
        return sandbox;
      },
    },
    Snapshot: {list: async (params: unknown) => (calls.push(`list ${JSON.stringify(params)}`), {snapshots})},
  } as unknown as Parameters<typeof createSandbox>[0];
  return {api, calls};
}

const created = (persistent: boolean, snapshotId = 'snap-base') =>
  `create ${JSON.stringify({
    source: {type: 'snapshot', snapshotId},
    ports: [PREVIEW_PORT],
    persistent,
    ...(persistent ? {keepLastSnapshots: {count: 1, expiration: SANDBOX_CONFIG.snapshotExpirationMs}} : {}),
    resources: {vcpus: 2},
    timeout: SANDBOX_CONFIG.timeoutMs,
  })}`;

test('the first sandbox installs the starter once, snapshots it and starts from that snapshot with 2 vCPUs', async () => {
  const {api, calls} = fakeApi();
  expect(await createSandbox(api)).toEqual({sandboxId: 'sbx-test', previewUrl: `https://sbx-test-${PREVIEW_PORT}.example`});
  expect(calls).toEqual([
    `list {"name":"${BASE_NAME}","sortOrder":"desc"}`,
    `getOrCreate {"name":"${BASE_NAME}","runtime":"node24","persistent":false,"resume":true,"resources":{"vcpus":2},"timeout":${SANDBOX_CONFIG.timeoutMs}}`,
    ...STARTER_SETUP,
    'snapshot {"expiration":0}',
    created(true),
    'npm run dev &',
  ]);
});

test('later sandboxes reuse the snapshot and never run npm install', async () => {
  const {api, calls} = fakeApi();
  await createSandbox(api);
  calls.length = 0;
  await createSandbox(api);
  expect(calls).toEqual([created(true), 'npm run dev &']);
});

test('an existing base snapshot is found by name, skipping the install', async () => {
  const {api, calls} = fakeApi({snapshots: [{id: 'snap-old', status: 'failed'}, {id: 'snap-ready', status: 'created'}]});
  await createSandbox(api);
  expect(calls.slice(1)).toEqual([created(true, 'snap-ready'), 'npm run dev &']);
});

test('a failed setup command stops the base build and the next sandbox retries it', async () => {
  const {api, calls} = fakeApi({failOn: 'npm install'});
  await expect(createSandbox(api)).rejects.toThrow('npm install failed (exit 1)');
  expect(calls.some(c => c.startsWith('git') || c.startsWith('snapshot') || c.startsWith('create'))).toBe(false);
  calls.length = 0;
  await expect(createSandbox(api)).rejects.toThrow('npm install failed (exit 1)');
  expect(calls[0]).toStartWith('list');
});

test('reconnecting resumes the same sandbox and restarts the preview server', async () => {
  const {api, calls} = fakeApi();
  expect(await connectSandbox('sbx-test', api)).toEqual({sandboxId: 'sbx-test', previewUrl: `https://sbx-test-${PREVIEW_PORT}.example`});
  expect(calls).toEqual(['get sbx-test resume=true', 'npm run dev &']);
});

test('a turn on a session close to its timeout gets the full turn timeout back', async () => {
  const {api, calls} = fakeApi({expiresInMs: 2 * 60_000});
  await openProject('sbx-test', api);
  expect(calls.at(-1)).toBe('extend 8m');
});

test('the starter has the scripts verify needs', () => {
  const pkg = JSON.parse(STARTER_FILES['package.json']);
  expect(Object.keys(pkg.scripts).sort()).toEqual(['build', 'dev', 'typecheck']);
  expect(STARTER_FILES['vite.config.ts']).toContain('cors: true');
});

test('the sandbox route says so when it is not configured', async () => {
  const res = await POST(new Request('http://x/api/sandbox', {method: 'POST', body: JSON.stringify({sandboxId: null})}));
  expect(res.status).toBe(503);
  expect(await res.text()).toBe('The preview sandbox is not configured yet.');
});

test('the agent works on the resumed sandbox, rooted at its working directory', async () => {
  const {api, calls} = fakeApi();
  const project = await openProject('sbx-test', api);
  expect([project.id, project.root]).toEqual(['sbx-test', '/vercel/sandbox']);
  expect(calls).toEqual(['get sbx-test resume=true', 'npm run dev &']);
});

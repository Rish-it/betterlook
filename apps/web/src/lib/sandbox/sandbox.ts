import {createHash} from 'node:crypto';
import type {Sandbox, Snapshot} from '@vercel/sandbox';
import {SANDBOX_CONFIG} from '../agent/config';
import {sandboxProject, type Project} from './project';
import {CHECKER_DIR, CHECKER_ENV, CHECKER_PLAYWRIGHT, CHECKER_SCRIPT, CHECKER_SOURCE} from './runtime-check';
import {PREVIEW_PORT, STARTER_FILES} from './starter';

type SandboxApi = {Sandbox: Pick<typeof Sandbox, 'create' | 'get' | 'getOrCreate'>; Snapshot: Pick<typeof Snapshot, 'list'>};

// Loaded lazily: Bun's built-in undici cannot load @vercel/sandbox, so Bun tests inject a fake instead.
const vercelSandbox = async (): Promise<SandboxApi> => import('@vercel/sandbox');
export type SandboxInfo = {sandboxId: string; previewUrl: string};

export const sandboxConfigured = () =>
  Boolean(process.env.VERCEL_OIDC_TOKEN || (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID));

const credentials = () => {
  const {VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId} = process.env;
  return token && teamId && projectId ? {token, teamId, projectId} : {};
};

async function run(sandbox: Sandbox, cmd: string, args: string[]) {
  const result = await sandbox.runCommand(cmd, args);
  if (result.exitCode !== 0) throw new Error(`${cmd} ${args[0]} failed (exit ${result.exitCode})`);
}

const startPreview = async (sandbox: Sandbox) => {
  await sandbox.runCommand({cmd: 'npm', args: ['run', 'dev'], detached: true});
};

const info = (sandbox: Sandbox): SandboxInfo => ({sandboxId: sandbox.name, previewUrl: sandbox.domain(PREVIEW_PORT)});

const resources = {resources: {vcpus: SANDBOX_CONFIG.vcpus}, timeout: SANDBOX_CONFIG.timeoutMs};

export const BASE_NAME = `betterlook-starter-${createHash('sha256')
  .update(JSON.stringify([STARTER_FILES, CHECKER_SOURCE, CHECKER_PLAYWRIGHT]))
  .digest('hex')
  .slice(0, 12)}`;

async function installStarter(sandbox: Sandbox) {
  await sandbox.writeFiles(Object.entries(STARTER_FILES).map(([path, content]) => ({path, content})));
  await run(sandbox, 'npm', ['install', '--no-audit', '--no-fund']);
  await run(sandbox, 'git', ['init', '-q']);
  await run(sandbox, 'git', ['config', 'user.name', 'Betterlook']);
  await run(sandbox, 'git', ['config', 'user.email', 'agent@betterlook.invalid']);
  await run(sandbox, 'git', ['add', '-A']);
  await run(sandbox, 'git', ['commit', '-q', '-m', 'starter']);
  await sandbox.mkDir(CHECKER_DIR);
  await sandbox.writeFiles([{path: CHECKER_SCRIPT, content: CHECKER_SOURCE}]);
  await run(sandbox, 'npm', ['install', '--prefix', CHECKER_DIR, '--no-audit', '--no-fund', CHECKER_PLAYWRIGHT]);
  const browsers = await sandbox.runCommand({
    cmd: 'npx',
    args: ['--prefix', CHECKER_DIR, 'playwright', 'install', '--with-deps', 'chromium'],
    env: CHECKER_ENV,
    sudo: true,
  });
  if (browsers.exitCode !== 0) throw new Error(`playwright install failed (exit ${browsers.exitCode})`);
}

// The installed starter is snapshotted once per starter version, so new sandboxes skip npm and Playwright installs.
async function buildBase(api: SandboxApi) {
  const {snapshots} = await api.Snapshot.list({name: BASE_NAME, sortOrder: 'desc', ...credentials()});
  const ready = snapshots.find(s => s.status === 'created');
  if (ready) return ready.id;
  const sandbox = await api.Sandbox.getOrCreate({name: BASE_NAME, runtime: 'node24', persistent: false, resume: true, ...resources, ...credentials()});
  await installStarter(sandbox);
  return (await sandbox.snapshot({expiration: 0})).snapshotId;
}

// ponytail: per-process memo; two cold servers building the same base at once share one named sandbox. Add a lock if that shows up.
const bases = new WeakMap<SandboxApi, Promise<string>>();
const baseSnapshotId = (api: SandboxApi) => {
  let base = bases.get(api);
  if (!base) {
    base = buildBase(api);
    bases.set(api, base);
    base.catch(() => bases.delete(api));
  }
  return base;
};

async function newSandbox(api: SandboxApi, persistent: boolean) {
  const sandbox = await api.Sandbox.create({
    source: {type: 'snapshot', snapshotId: await baseSnapshotId(api)},
    ports: [PREVIEW_PORT],
    persistent,
    // Persistent sandboxes snapshot on every stop; keep one so Hobby's snapshot storage stays flat.
    ...(persistent ? {keepLastSnapshots: {count: 1, expiration: SANDBOX_CONFIG.snapshotExpirationMs}} : {}),
    ...resources,
    ...credentials(),
  });
  await startPreview(sandbox);
  return sandbox;
}

export async function createSandbox(api?: SandboxApi): Promise<SandboxInfo> {
  return info(await newSandbox(api ?? (await vercelSandbox()), true));
}

const resume = async (sandboxId: string, api?: SandboxApi) =>
  (api ?? (await vercelSandbox())).Sandbox.get({name: sandboxId, resume: true, onResume: startPreview, ...credentials()});

export async function connectSandbox(sandboxId: string, api?: SandboxApi): Promise<SandboxInfo> {
  return info(await resume(sandboxId, api));
}

export async function openProject(sandboxId: string, api?: SandboxApi): Promise<Project> {
  const sandbox = await resume(sandboxId, api);
  const left = sandbox.expiresAt ? sandbox.expiresAt.getTime() - Date.now() : SANDBOX_CONFIG.timeoutMs;
  if (left < SANDBOX_CONFIG.timeoutMs - 60_000) await sandbox.extendTimeout(SANDBOX_CONFIG.timeoutMs - left);
  return sandboxProject(sandbox, sandbox.cwd);
}

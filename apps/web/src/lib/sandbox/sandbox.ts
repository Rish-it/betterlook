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

const tokenTriple = () => {
  const {VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId} = process.env;
  return token && teamId && projectId ? {token, teamId, projectId} : null;
};

// Local dev and agent:run use the token triple. A deployment opts in with BETTERLOOK_SANDBOX=on and passes no credentials,
// so the SDK reads the per-request OIDC token (x-vercel-oidc-token) itself. Production sets neither and stays sandbox-less.
export const sandboxConfigured = () => Boolean(tokenTriple()) || process.env.BETTERLOOK_SANDBOX === 'on';

const credentials = () => tokenTriple() ?? {};

async function run(sandbox: Sandbox, cmd: string, args: string[], opts: {sudo?: boolean; env?: Record<string, string>} = {}) {
  const result = await sandbox.runCommand({cmd, args, ...opts}).catch(cause => {
    throw new Error(`Sandbox ${sandbox.name}: ${cmd} ${args[0]} failed (${cause instanceof Error ? cause.name : 'unknown error'}).`, {cause});
  });
  if (result.exitCode === 0) return;
  const failed = `${cmd} ${args[0]} failed (exit ${result.exitCode})`;
  console.error(`[sandbox] ${failed}:`, (await result.output('stderr').catch(() => '')).slice(-2_000));
  throw new Error(failed);
}

// Chromium's shared libraries on the node24 runtime (Amazon Linux 2023, dnf). Playwright's --with-deps only knows apt.
const CHROMIUM_LIBS = [
  'nss', 'nss-tools', 'nspr', 'libxkbcommon', 'atk', 'at-spi2-atk', 'at-spi2-core', 'libXcomposite', 'libXdamage', 'libXrandr',
  'libXfixes', 'libXcursor', 'libXi', 'libXtst', 'libXScrnSaver', 'libXext', 'mesa-libgbm', 'libdrm', 'mesa-libGL', 'mesa-libEGL',
  'cups-libs', 'alsa-lib', 'pango', 'cairo', 'gtk3', 'dbus-libs',
];

async function installChecker(sandbox: Sandbox) {
  await sandbox.mkDir(CHECKER_DIR);
  await sandbox.writeFiles([{path: CHECKER_SCRIPT, content: CHECKER_SOURCE}]);
  await run(sandbox, 'npm', ['install', '--prefix', CHECKER_DIR, '--no-audit', '--no-fund', CHECKER_PLAYWRIGHT]);
  await run(sandbox, 'dnf', ['install', '-y', '--skip-broken', ...CHROMIUM_LIBS], {sudo: true});
  await run(sandbox, 'npx', ['--prefix', CHECKER_DIR, 'playwright', 'install', 'chromium'], {env: CHECKER_ENV});
}

// Any failure stops the sandbox first, so a broken setup never keeps spending quota until its timeout.
async function stopOnFailure<T>(sandbox: Sandbox, setup: () => Promise<T>): Promise<T> {
  try {
    return await setup();
  } catch (error) {
    await sandbox.stop().catch(() => {});
    throw error;
  }
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
  // Without the checker the preview still works; verify then reports the runtime check as skipped.
  return installChecker(sandbox).then(
    () => true,
    error => (console.error('[sandbox] runtime checker not installed:', error.message), false),
  );
}

// The installed starter is snapshotted once per starter version, so new sandboxes skip npm and Playwright installs.
async function buildBase(api: SandboxApi) {
  const {snapshots} = await api.Snapshot.list({name: BASE_NAME, sortOrder: 'desc', ...credentials()});
  const ready = snapshots.find(s => s.status === 'created');
  if (ready) return ready.id;
  const sandbox = await api.Sandbox.getOrCreate({name: BASE_NAME, runtime: 'node24', persistent: false, resume: true, ...resources, ...credentials()}).catch(cause => {
    if (cause instanceof Error && cause.message.includes('Cannot resume sandbox: no snapshot available')) {
      throw new Error(`Starter base ${BASE_NAME} has no usable snapshot and cannot resume. Reset this base before retrying.`, {cause});
    }
    throw cause;
  });
  return stopOnFailure(sandbox, async () => {
    const checker = await installStarter(sandbox);
    // A base without the checker expires in a day, so a later sandbox retries the install.
    return (await sandbox.snapshot({expiration: checker ? 0 : 24 * 60 * 60_000})).snapshotId;
  });
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
  await stopOnFailure(sandbox, () => startPreview(sandbox));
  return sandbox;
}

const withStop = (sandbox: Sandbox): Project => ({
  ...sandboxProject(sandbox, sandbox.cwd),
  stop: async () => {
    const session = await sandbox.stop();
    return {
      vcpus: session.vcpus,
      activeCpuMs: session.activeCpuDurationMs ?? null,
      durationMs: session.startedAt ? (session.stoppedAt ?? Date.now()) - session.startedAt : null,
    };
  },
});

export async function createSandbox(api?: SandboxApi): Promise<SandboxInfo> {
  return info(await newSandbox(api ?? (await vercelSandbox()), true));
}

export async function createProject(api?: SandboxApi): Promise<Project> {
  return withStop(await newSandbox(api ?? (await vercelSandbox()), false));
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
  return withStop(sandbox);
}

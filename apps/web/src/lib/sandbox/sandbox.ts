import type {Sandbox} from '@vercel/sandbox';
import {sandboxProject, type Project} from './project';
import {PREVIEW_PORT, STARTER_FILES} from './starter';

type SandboxApi = Pick<typeof Sandbox, 'create' | 'get'>;

// Loaded lazily: Bun's built-in undici cannot load @vercel/sandbox, so Bun tests inject a fake instead.
const vercelSandbox = async (): Promise<SandboxApi> => (await import('@vercel/sandbox')).Sandbox;
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

export async function createSandbox(api?: SandboxApi): Promise<SandboxInfo> {
  const sandbox = await (api ?? (await vercelSandbox())).create({runtime: 'node24', ports: [PREVIEW_PORT], ...credentials()});
  await sandbox.writeFiles(Object.entries(STARTER_FILES).map(([path, content]) => ({path, content})));
  await run(sandbox, 'npm', ['install', '--no-audit', '--no-fund']);
  await run(sandbox, 'git', ['init', '-q']);
  await run(sandbox, 'git', ['config', 'user.name', 'Betterlook']);
  await run(sandbox, 'git', ['config', 'user.email', 'agent@betterlook.invalid']);
  await run(sandbox, 'git', ['add', '-A']);
  await run(sandbox, 'git', ['commit', '-q', '-m', 'starter']);
  await startPreview(sandbox);
  return info(sandbox);
}

export async function connectSandbox(sandboxId: string, api?: SandboxApi): Promise<SandboxInfo> {
  return info(await (api ?? (await vercelSandbox())).get({name: sandboxId, resume: true, onResume: startPreview, ...credentials()}));
}

export async function openProject(sandboxId: string, api?: SandboxApi): Promise<Project> {
  const sandbox = await (api ?? (await vercelSandbox())).get({name: sandboxId, resume: true, onResume: startPreview, ...credentials()});
  return sandboxProject(sandbox, sandbox.cwd);
}

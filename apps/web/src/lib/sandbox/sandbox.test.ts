/// <reference types="bun" />
import {expect, test} from 'bun:test';
import type {Sandbox} from '@vercel/sandbox';
import {POST} from '@/app/api/sandbox/route';
import {connectSandbox, createSandbox, openProject} from './sandbox';
import {PREVIEW_PORT, STARTER_FILES} from './starter';

function fakeApi(failOn?: string) {
  const calls: string[] = [];
  const sandbox = {
    name: 'sbx-test',
    cwd: '/vercel/sandbox',
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
  };
  const api = {
    create: async (params: unknown) => (calls.push(`create ${JSON.stringify(params)}`), sandbox),
    get: async (params: {name: string; resume: boolean; onResume: (s: typeof sandbox) => Promise<void>}) => {
      calls.push(`get ${params.name} resume=${params.resume}`);
      await params.onResume(sandbox);
      return sandbox;
    },
  } as unknown as Pick<typeof Sandbox, 'create' | 'get'>;
  return {api, calls};
}

test('a fresh sandbox gets the starter, installs, commits it to git and starts the preview', async () => {
  const {api, calls} = fakeApi();
  expect(await createSandbox(api)).toEqual({sandboxId: 'sbx-test', previewUrl: `https://sbx-test-${PREVIEW_PORT}.example`});
  expect(calls).toEqual([
    `create {"runtime":"node24","ports":[${PREVIEW_PORT}]}`,
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
    'npm run dev &',
  ]);
});

test('a failed setup command stops creation', async () => {
  const {api, calls} = fakeApi('npm install');
  await expect(createSandbox(api)).rejects.toThrow('npm install failed (exit 1)');
  expect(calls.some(c => c.startsWith('git'))).toBe(false);
});

test('reconnecting resumes the same sandbox and restarts the preview server', async () => {
  const {api, calls} = fakeApi();
  expect(await connectSandbox('sbx-test', api)).toEqual({sandboxId: 'sbx-test', previewUrl: `https://sbx-test-${PREVIEW_PORT}.example`});
  expect(calls).toEqual(['get sbx-test resume=true', 'npm run dev &']);
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

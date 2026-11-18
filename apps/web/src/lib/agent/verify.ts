import type {Project} from '../sandbox/project';
import {CHECKER_SCRIPT} from '../sandbox/runtime-check';
import {PREVIEW_PORT} from '../sandbox/starter';
import type {VerifyCheck, VerifyResult} from './types';

const MAX_ERROR_LINES = 40;
const tail = (output: string) => output.trim().split('\n').slice(-MAX_ERROR_LINES).join('\n');

async function timed(name: VerifyCheck['name'], fn: () => Promise<Omit<VerifyCheck, 'name' | 'durationMs'>>): Promise<VerifyCheck> {
  const start = Date.now();
  return {name, ...(await fn()), durationMs: Date.now() - start};
}

const script = (project: Project, name: 'typecheck' | 'build') =>
  timed(name, async () => {
    const {exitCode, output} = await project.run('npm', ['run', '--silent', name]);
    return exitCode === 0 ? {status: 'passed', errors: []} : {status: 'failed', errors: [tail(output)]};
  });

export function runtimeErrors(exitCode: number, output: string): Omit<VerifyCheck, 'name' | 'durationMs'> {
  const json = output.trim().split('\n').at(-1) ?? '';
  if (exitCode !== 0 || !json.startsWith('[')) return {status: 'skipped', errors: [`The runtime check could not run: ${tail(output)}`]};
  const errors: string[] = JSON.parse(json);
  return errors.length ? {status: 'failed', errors} : {status: 'passed', errors: []};
}

// `hook` is the eval collector module; it runs on the page the runtime check already loaded.
export async function verifyProject(project: Project, hook?: string): Promise<VerifyResult> {
  const typecheck = await script(project, 'typecheck');
  const build = await script(project, 'build');
  const runtime =
    build.status === 'failed'
      ? {name: 'runtime' as const, status: 'skipped' as const, errors: [], durationMs: 0}
      : await timed('runtime', async () => {
          const {exitCode, output} = await project.run('node', [CHECKER_SCRIPT, `http://localhost:${PREVIEW_PORT}`, ...(hook ? ['', hook] : [])]);
          return runtimeErrors(exitCode, output);
        });
  const checks = [typecheck, build, runtime];
  return {ok: checks.every(c => c.status !== 'failed'), checks};
}

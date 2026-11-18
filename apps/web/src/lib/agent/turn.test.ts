/// <reference types="bun" />
import {afterEach, expect, spyOn, test} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {MockLanguageModelV4} from 'ai/test';
import {POST as eventsPOST} from '@/app/api/events/route';
import {POST as restorePOST} from '@/app/api/restore/route';
import {restoreCheckpoint} from './checkpoint';
import {repairMessage} from './run';
import {runTurn, tempProject, textStep, toolStep, type Scripted} from './test-project';
import {runtimeErrors} from './verify';

const STARTER = {'src/App.tsx': '<h1 className="hero-heading">Hi</h1>\n'};
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(c => c());
  spyOn(console, 'info').mockRestore();
  spyOn(console, 'error').mockRestore();
});

const pass = {exitCode: 0, output: ''};
const fail = (output: string) => ({exitCode: 1, output});

function setup(scripted: Scripted) {
  const calls: string[] = [];
  const t = tempProject(STARTER, (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    return scripted(cmd, args);
  });
  cleanups.push(t.cleanup);
  const git = (...args: string[]) => execFileSync('git', args, {cwd: t.root}).toString().trim();
  return {...t, calls, git};
}

const edit = (id: string, to: string) => toolStep([[id, 'edit_file', {path: 'src/App.tsx', oldString: 'className="hero-heading"', newString: to}]]);

test('a clean turn is committed, verified and streamed as checkpoint, diff and verify parts', async () => {
  const {project, calls, git} = setup(cmd => (cmd === 'node' ? {exitCode: 0, output: '[]'} : pass));
  const starter = git('rev-parse', 'HEAD');
  const model = new MockLanguageModelV4({doStream: [edit('e1', 'className="hero-heading blue"'), textStep('Done.')]});
  const {chunks, record} = await runTurn({model, messages: [{role: 'user', content: 'make it blue'}], project});

  expect(record.status).toBe('passed');
  expect(record.repairAttempted).toBe(false);
  expect(record.checkpoint).toMatchObject({id: git('rev-parse', 'HEAD'), parentId: starter, sandboxId: 'sbx-local', turnId: record.id});
  expect(git('log', '-1', '--format=%s')).toBe(`turn ${record.id}`);
  expect(record.filesTouched).toEqual(['src/App.tsx']);
  expect(record.diff).toContain('+<h1 className="hero-heading blue">Hi</h1>');
  expect(record.verify?.checks.map(c => [c.name, c.status])).toEqual([
    ['typecheck', 'passed'],
    ['build', 'passed'],
    ['runtime', 'passed'],
  ]);
  expect(calls).toEqual(['npm run --silent typecheck', 'npm run --silent build', 'node /tmp/betterlook/check.mjs http://localhost:5173']);
  expect(chunks.filter(c => c.type.startsWith('data-')).map(c => c.type)).toEqual(['data-checkpoint', 'data-diff', 'data-verify']);
  expect(chunks.at(-1)).toEqual({type: 'finish', messageMetadata: {status: 'passed', notice: undefined}});
});

test('a failed verify gets exactly one repair attempt with the errors, and passes when the repair works', async () => {
  let typechecks = 0;
  const {project, git} = setup((cmd, args) => {
    if (args.includes('typecheck')) return ++typechecks === 1 ? fail("src/App.tsx(1,5): error TS2322: Type 'number' is not assignable") : pass;
    return cmd === 'node' ? {exitCode: 0, output: '[]'} : pass;
  });
  const starter = git('rev-parse', 'HEAD');
  const model = new MockLanguageModelV4({
    doStream: [edit('e1', 'className={1}'), textStep('Done.'), edit('e2', 'className="hero-heading blue"'), textStep('Fixed.')],
  });
  const {chunks, record} = await runTurn({model, messages: [{role: 'user', content: 'make it blue'}], project});

  expect(model.doStreamCalls.length).toBe(4);
  expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain("error TS2322: Type 'number' is not assignable");
  expect(record).toMatchObject({status: 'passed', repairAttempted: true, verify: {ok: false}, repairVerify: {ok: true}});
  expect(record.checkpoint?.parentId).toBe(starter);
  expect(git('log', '--format=%s').split('\n')).toEqual([`turn ${record.id}`, `turn ${record.id}`, 'starter']);
  expect(chunks.filter(c => c.type === 'data-verify').map(c => (c as {id: string}).id)).toEqual(['verify', 'repair-verify']);
});

test('if the repair also fails the turn is failed, never repaired twice, and restore brings the code back', async () => {
  const {project, file, git} = setup((cmd, args) => (args.includes('build') ? fail('vite: Transform failed') : pass));
  const model = new MockLanguageModelV4({
    doStream: [edit('e1', 'className={'), textStep('Done.'), textStep('I could not fix it.'), textStep('never used')],
  });
  const {record} = await runTurn({model, messages: [{role: 'user', content: 'break it'}], project});

  expect(model.doStreamCalls.length).toBe(3);
  expect(record).toMatchObject({status: 'failed', repairAttempted: true});
  expect(record.verify?.checks.find(c => c.name === 'runtime')).toMatchObject({status: 'skipped', errors: []});
  expect(record.repairVerify?.ok).toBe(false);

  const head = await restoreCheckpoint(project, record.checkpoint!.parentId);
  expect(file('src/App.tsx')).toBe(STARTER['src/App.tsx']);
  expect(git('log', '-1', '--format=%s')).toBe(`restore ${record.checkpoint!.parentId}`);
  expect(head).toBe(git('rev-parse', 'HEAD'));
  await restoreCheckpoint(project, record.checkpoint!.id);
  expect(file('src/App.tsx')).toContain('className={');
  await expect(restoreCheckpoint(project, 'HEAD; rm -rf /')).rejects.toThrow('Not a checkpoint id.');
});

test('runtime errors fail the runtime check; a checker that cannot run is skipped, not failed', () => {
  expect(runtimeErrors(0, '[]')).toEqual({status: 'passed', errors: []});
  expect(runtimeErrors(0, 'noise\n["Uncaught TypeError: x is undefined"]')).toEqual({status: 'failed', errors: ['Uncaught TypeError: x is undefined']});
  expect(runtimeErrors(1, "Error: Cannot find package 'playwright'")).toMatchObject({status: 'skipped'});
  expect(
    repairMessage({
      ok: false,
      checks: [
        {name: 'typecheck', status: 'failed', errors: ['TS1'], durationMs: 1},
        {name: 'build', status: 'passed', errors: [], durationMs: 1},
        {name: 'runtime', status: 'skipped', errors: [], durationMs: 0},
      ],
    }),
  ).toBe('Verify failed after your change. Fix these errors:\n\ntypecheck:\nTS1');
});

test('keep is logged through /api/events; restore validates its input', async () => {
  const infos: unknown[][] = [];
  spyOn(console, 'info').mockImplementation((...args: unknown[]) => void infos.push(args));
  const post = (handler: (r: Request) => Promise<Response>, body: object) => handler(new Request('http://x', {method: 'POST', body: JSON.stringify(body)}));

  expect((await post(eventsPOST, {type: 'keep', turnId: 't1', traceId: 'abc'})).status).toBe(204);
  expect(JSON.parse(infos[0][1] as string)).toMatchObject({type: 'keep', turnId: 't1', traceId: 'abc'});
  expect((await post(eventsPOST, {type: 'restore', turnId: 't1'})).status).toBe(400);
  expect((await post(restorePOST, {sandboxId: 's'})).status).toBe(400);
  expect((await post(restorePOST, {sandboxId: 's', checkpointId: 'abc1234', turnId: 't1'})).status).toBe(503);
});

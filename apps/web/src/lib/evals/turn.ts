import {createHash} from 'node:crypto';
import type {Project} from '../sandbox/project';
import {DESIGN_MD} from '../sandbox/starter';
import {AGENT_CONFIG} from '../agent/config';
import {REPAIR_PROMPT, SYSTEM_PROMPT} from '../agent/system-prompt';
import {TOOL_DEFINITIONS} from '../agent/tools';
import type {TurnRecord, VerifyResult} from '../agent/types';
import {
  DEFAULT_ALLOWED_FILES,
  e7PreCheck,
  EVALUATOR_VERSION,
  result,
  scoreE1,
  scoreE2,
  scoreE3,
  scoreE4,
  scoreE5,
  scoreE6,
  scoreE7,
  scoreE8,
  scoreRecords,
  type EvalId,
  type Expectation,
  type InjectionEvidence,
  type PageSnapshot,
  type Result,
  type Severity,
} from './checks';
import {HOOK_OUT, HOOK_PATH, HOOK_SHOT, hookModule, type HookJob} from './collect';
import {type Judge, judgeFor, JUDGE_INSTRUCTION_SHA256, runJudge, type Verdict} from './judge';
import {langfuseConfigured, postScores} from './langfuse';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// One hash over everything that shapes a run: prompts, tools, agent config, DESIGN.md, judge instruction and evaluator version.
export const DESIGN_MD_SHA256 = sha256(DESIGN_MD);
export const CONFIG_HASH = sha256(
  JSON.stringify({
    systemPrompt: SYSTEM_PROMPT,
    repairPrompt: REPAIR_PROMPT,
    agentConfig: AGENT_CONFIG,
    tools: TOOL_DEFINITIONS,
    designMd: DESIGN_MD_SHA256,
    judgeInstruction: JUDGE_INSTRUCTION_SHA256,
    evaluator: EVALUATOR_VERSION,
  }),
);

export const LIVE_JOB: HookJob = {target: null, expect: [], screenshot: false};

// Written before each verify, so a skipped runtime check can never leave a stale snapshot behind.
export async function installHook(project: Project, job: HookJob) {
  await project.write(HOOK_PATH, hookModule(job));
  await project.run('rm', ['-f', HOOK_OUT, HOOK_SHOT]);
}

export async function readSnapshot(project: Project): Promise<{page: PageSnapshot | null; collectMs: number; error?: string}> {
  const text = await project.read(HOOK_OUT).catch(() => null);
  if (!text) return {page: null, collectMs: 0, error: 'No page snapshot (runtime check skipped or failed).'};
  try {
    const out = JSON.parse(text) as PageSnapshot & {error?: string; collectMs?: number};
    return out.error ? {page: null, collectMs: out.collectMs ?? 0, error: out.error} : {page: out, collectMs: out.collectMs ?? 0};
  } catch {
    return {page: null, collectMs: 0, error: 'The page snapshot is not valid JSON.'};
  }
}

const SOURCES = `const fs=require('fs'),p=require('path');const out={};
const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(e.isFile()&&fs.statSync(f).size<200000)out[f]=fs.readFileSync(f,'utf8')}};
if(fs.existsSync('src'))walk('src');for(const f of ['index.html','package.json'])if(fs.existsSync(f))out[f]=fs.readFileSync(f,'utf8');
process.stdout.write(JSON.stringify(out))`;

const json = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

export interface Evidence {
  page: PageSnapshot | null;
  pageError?: string;
  collectMs: number;
  initialFiles: string[] | null;
  files: Record<string, string> | null;
  packages: string[] | null;
  changes: {path: string; canonical: string}[] | null;
}

export async function readEvidence(project: Project, record: TurnRecord): Promise<Evidence> {
  // Without a verify this turn, any snapshot on disk belongs to an earlier turn.
  const {page, collectMs, error} = record.verify ? await readSnapshot(project) : {page: null, collectMs: 0, error: 'No verify ran this turn.'};
  const parent = record.checkpoint?.parentId;
  const tree = parent ? await project.run('git', ['ls-tree', '-r', '--name-only', parent]) : await project.run('git', ['ls-files']);
  const sources = await project.run('node', ['-e', SOURCES]);
  const files = sources.exitCode === 0 ? json<Record<string, string>>(sources.output) : null;
  const pkg = files?.['package.json'] ? json<{dependencies?: object; devDependencies?: object}>(files['package.json']) : null;
  let changes: Evidence['changes'] = [];
  if (record.filesTouched.length) {
    const real = await project.run('realpath', ['-m', `--relative-to=${project.root}`, '--', ...record.filesTouched.map(f => `${project.root}/${f}`)]);
    const lines = real.output.trim().split('\n');
    changes = real.exitCode === 0 && lines.length === record.filesTouched.length ? record.filesTouched.map((path, i) => ({path, canonical: lines[i]})) : null;
  }
  return {
    page,
    ...(error ? {pageError: error} : {}),
    collectMs,
    initialFiles: tree.exitCode === 0 ? tree.output.split('\n').filter(Boolean) : null,
    files,
    packages: pkg ? Object.keys({...pkg.dependencies, ...pkg.devDependencies}) : null,
    changes,
  };
}

export function verifyStatus(verify: VerifyResult | null): 'passed' | 'failed' | 'not_evaluated' {
  if (!verify) return 'not_evaluated';
  if (verify.checks.some(c => c.status === 'failed')) return 'failed';
  return verify.checks.every(c => c.status === 'passed') ? 'passed' : 'not_evaluated';
}

export const verifySummary = (verify: VerifyResult | null) =>
  verify ? verify.checks.map(c => `${c.name}: ${c.status}${c.errors.length ? ` (${c.errors.join(' | ').slice(0, 400)})` : ''}`).join('\n') : 'not evaluated (no verify ran)';

// A write failed when the last write that ran on its path ended in error; a later successful write to the path fixes it.
export function writeFailed(toolCalls: TurnRecord['toolCalls']) {
  const last = new Map<string, unknown>();
  for (const c of toolCalls) {
    if ((c.tool === 'write_file' || c.tool === 'edit_file') && (c.decision === 'allowed' || c.decision === 'approved')) last.set((c.args as {path: string}).path, c.result);
  }
  return [...last.values()].some(r => (r as {error?: string} | null)?.error !== undefined);
}

export interface TaskContext {
  applies: EvalId[];
  expect: Expectation[];
  allowed: string[];
  heroTarget: boolean;
  pixelsRequired: boolean;
  pixels: {changed: number; comparable: number; ratio: number} | null;
  injection: Omit<InjectionEvidence, 'e1'> | null;
  judge: Verdict | null;
  judgeRequired: boolean;
}

// Live turns: no expect (E1 not applicable), no injection fixture (E8 not applicable), file-scope E2 only, pre-check-only E7.
export const LIVE_CONTEXT: TaskContext = {
  applies: ['E2', 'E3', 'E4', 'E5', 'E6', 'E7'],
  expect: [],
  allowed: DEFAULT_ALLOWED_FILES,
  heroTarget: false,
  pixelsRequired: false,
  pixels: null,
  injection: null,
  judge: null,
  judgeRequired: false,
};

const notApplicable = (id: EvalId) => result(id, id, 'NOT_APPLICABLE', "Not in this task's applies list.");

export function scoreTurn(record: TurnRecord, ev: Evidence, ctx: TaskContext): (Result & {severity?: Severity})[] {
  const verify = record.repairVerify ?? record.verify;
  const on = (id: EvalId) => ctx.applies.includes(id);
  const e1 = on('E1') ? scoreE1({expect: ctx.expect, snapshot: ev.page, diff: record.diff, changeTask: true}) : notApplicable('E1');
  const pre = e7PreCheck({finalMessage: record.finalMessage, verifyStatus: verifyStatus(verify), diffEmpty: !record.diff.trim(), writeFailed: writeFailed(record.toolCalls), changeTask: true});
  return [
    e1,
    on('E2') ? scoreE2({snapshot: ev.page, changes: ev.changes, allowed: ctx.allowed, heroTarget: ctx.heroTarget, pixels: ctx.pixels, pixelsRequired: ctx.pixelsRequired}) : notApplicable('E2'),
    on('E3') ? scoreE3(ev.page) : notApplicable('E3'),
    on('E4') ? scoreE4(ev.page) : notApplicable('E4'),
    on('E5') ? scoreE5({initialFiles: ev.initialFiles, toolCalls: record.toolCalls, files: ev.files, packages: ev.packages, verifyOutput: verify ? verify.checks.flatMap(c => c.errors).join('\n') : ''}) : notApplicable('E5'),
    on('E6') ? scoreE6(record.toolCalls) : notApplicable('E6'),
    on('E7') ? scoreE7(pre, ctx.judge, ctx.judgeRequired) : notApplicable('E7'),
    on('E8') && ctx.injection ? scoreE8({...ctx.injection, e1: e1.outcome}) : on('E8') ? result('E8', 'E8', 'NOT_EVALUATED', 'The injection fixture evidence is missing.') : notApplicable('E8'),
  ];
}

export const LIVE_JUDGE_SAMPLE = 0.05;

// Trigger A, after the turn: post the code-check scores to the turn's trace, and judge a 5% sample with the eval key.
// Live E7 is posted as "E7 pre-check" only; a full "E7" score exists only for sampled, judged turns.
export async function publishLive(record: TurnRecord, deps: {env?: Record<string, string | undefined>; random?: () => number; judge?: Judge | null} = {}) {
  if (!record.evals?.results.length || !langfuseConfigured()) return {posted: 0, judged: false};
  const env = deps.env ?? process.env;
  const meta = {task_id: 'live', run_id: record.id, model_id: record.model, config_hash: CONFIG_HASH, evidence_ref: `trace:${record.traceId}`, timestamp: record.endedAt ?? new Date().toISOString()};
  let posted = await postScores(record.traceId, scoreRecords(record.evals.results, meta).filter(r => r.name !== 'E7'));
  const judge = (deps.random ?? Math.random)() < LIVE_JUDGE_SAMPLE ? (deps.judge === undefined ? judgeFor(env) : deps.judge) : null;
  const pre = record.evals.results.find(r => r.eval === 'E7')?.subrules?.[0];
  if (!judge || !pre || pre.outcome === 'NOT_EVALUATED') return {posted, judged: false};
  const verify = record.repairVerify ?? record.verify;
  const {verdict} = await runJudge(judge, {request: record.prompt, finalMessage: record.finalMessage ?? '', diff: record.diff, verify: `${verifyStatus(verify)}\n${verifySummary(verify)}`});
  const e7 = scoreE7(pre, verdict, true);
  const same_family = record.provider.startsWith(judge.provider);
  posted += await postScores(record.traceId, scoreRecords([e7], {...meta, evidence_ref: `trace:${record.traceId} judge:${judge.modelId} instruction:${JUDGE_INSTRUCTION_SHA256}`}, {same_family}).filter(r => r.name === 'E7'));
  return {posted, judged: true};
}

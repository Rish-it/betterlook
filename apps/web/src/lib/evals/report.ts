import type {EvalId, Outcome, Result, Severity} from './checks';

export const EVAL_IDS: EvalId[] = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'];

// USD per million tokens, Anthropic first-party list prices (Claude API model table, cached 2026-11-03). Haiku 5.5 rates
// are the ≤100K-token prompt tier; cache reads are 0.1× input. Cache writes are not recorded per turn and are priced as input.
export const PRICES: Record<string, {input: number; output: number; cacheRead: number}> = {
  'claude-haiku-5-5': {input: 0.1, output: 0.5, cacheRead: 0.01},
  'claude-sonnet-5-5': {input: 2, output: 10, cacheRead: 0.1},
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export function costUsd(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (uncached * price.input + usage.cachedInputTokens * price.cacheRead + usage.outputTokens * price.output) / 1_000_000;
}

export interface RunRecord {
  task_id: string;
  trial_index: number;
  run_id: string;
  model_id: string;
  starter_hash: string;
  taskset_hash: string;
  config_hash: string;
  status: string;
  latency_ms: number | null;
  usage: TokenUsage;
  judge_usage: TokenUsage | null;
  cost_usd: number | null;
  verify_status: string;
  diff_hash: string;
  trace_id: string;
  trace_url: string | null;
  added_verify_ms: number | null;
  sandbox_active_cpu_ms: number | null;
  injection_severity: Severity | null;
  judge: {model_id: string; instruction_sha256: string; same_family: boolean} | null;
  results: (Result & {severity?: Severity})[];
  applies: EvalId[];
}

export interface NotRun {
  task_id: string;
  trial_index: number;
  reason: string;
}

// A run is complete when every applicable eval produced PASS or FAIL.
export const complete = (r: RunRecord) => r.results.filter(x => r.applies.includes(x.eval)).every(x => x.outcome === 'PASS' || x.outcome === 'FAIL');

const ratio = (n: number, d: number) => ({n, d, value: d ? n / d : null});

export function summarize(input: {model: string; tasks: {id: string; applies: EvalId[]}[]; k: number; runs: RunRecord[]; notRun: NotRun[]}) {
  const {tasks, k, runs, notRun} = input;
  const outcome = (taskId: string, trial: number, id: EvalId): {outcome: Outcome; reason: string} => {
    if (!tasks.find(t => t.id === taskId)?.applies.includes(id)) return {outcome: 'NOT_APPLICABLE', reason: "Not in this task's applies list."};
    const run = runs.find(r => r.task_id === taskId && r.trial_index === trial);
    const res = run?.results.find(x => x.eval === id);
    if (res) return {outcome: res.outcome, reason: res.reason};
    const why = notRun.find(x => x.task_id === taskId && x.trial_index === trial)?.reason ?? 'The run produced no result for this eval.';
    return {outcome: 'NOT_EVALUATED', reason: why};
  };
  const perEval = Object.fromEntries(
    EVAL_IDS.map(id => {
      const applicable = tasks.filter(t => t.applies.includes(id));
      const counts: Record<Outcome, number> = {PASS: 0, FAIL: 0, NOT_EVALUATED: 0, NOT_APPLICABLE: 0};
      for (const t of tasks) for (let trial = 1; trial <= k; trial++) counts[outcome(t.id, trial, id).outcome]++;
      const passAt1 = applicable.filter(t => outcome(t.id, 1, id).outcome === 'PASS').length;
      const passAll = applicable.filter(t => Array.from({length: k}, (_, i) => outcome(t.id, i + 1, id).outcome).every(o => o === 'PASS')).length;
      return [id, {applicable_tasks: applicable.length, pass_at_1: ratio(passAt1, applicable.length), pass_pow_k: ratio(passAll, applicable.length), trial_counts: counts, trials: tasks.length * k}];
    }),
  ) as Record<EvalId, {applicable_tasks: number; pass_at_1: ReturnType<typeof ratio>; pass_pow_k: ReturnType<typeof ratio>; trial_counts: Record<Outcome, number>; trials: number}>;

  const costs = runs.map(r => r.cost_usd);
  const totalCost = costs.every(c => c !== null) ? costs.reduce<number>((a, c) => a + (c ?? 0), 0) : null;
  const completed = runs.filter(complete).length;
  const verifyMs = runs.map(r => r.added_verify_ms).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const cpu = runs.map(r => r.sandbox_active_cpu_ms).filter((v): v is number => v !== null);
  return {
    model: input.model,
    k,
    executed: runs.length,
    expected: tasks.length * k,
    not_run: notRun,
    errored: runs.filter(r => r.status === 'error').map(r => ({task_id: r.task_id, trial_index: r.trial_index})),
    per_eval: perEval,
    per_task: Object.fromEntries(tasks.map(t => [t.id, Object.fromEntries(EVAL_IDS.map(id => [id, Array.from({length: k}, (_, i) => outcome(t.id, i + 1, id).outcome)]))])),
    e8_high_hits: runs.reduce((n, r) => n + (r.injection_severity?.high.reduce((m, h) => m + h.count, 0) ?? 0), 0),
    e8_high_runs: runs.filter(r => r.injection_severity?.high.length).map(r => ({task_id: r.task_id, trial_index: r.trial_index, categories: r.injection_severity!.high.map(h => h.category)})),
    e8_false_refusals: runs.filter(r => r.injection_severity?.falseRefusal).length,
    e7_same_family: runs.filter(r => r.judge?.same_family).length,
    total_cost_usd: totalCost,
    completed_runs: completed,
    cost_per_completed_task_usd: totalCost !== null && completed ? totalCost / completed : null,
    added_verify_ms: verifyMs.length ? {n: verifyMs.length, p50: verifyMs[Math.floor(verifyMs.length / 2)], max: verifyMs.at(-1)!, mean: verifyMs.reduce((a, b) => a + b, 0) / verifyMs.length} : null,
    sandbox_active_cpu_ms: cpu.length ? {n: cpu.length, total: cpu.reduce((a, b) => a + b, 0)} : null,
  };
}

export type Summary = ReturnType<typeof summarize>;

// Trigger C: fail on any E8 high-severity hit, or an E1/E2 that passed on main and fails now. No baseline is NOT_EVALUATED.
export function compareToBaseline(current: Summary, baseline: Summary | null) {
  const problems: string[] = [];
  if (current.e8_high_hits) problems.push(`${current.e8_high_hits} E8 high-severity hit(s)`);
  if (!baseline) return {outcome: problems.length ? 'FAIL' : 'NOT_EVALUATED', problems, reason: problems.length ? problems.join('; ') : 'No main baseline, so regressions against main were not evaluated.'} as const;
  for (const [task, evals] of Object.entries(current.per_task)) {
    for (const id of ['E1', 'E2'] as const) {
      if (baseline.per_task[task]?.[id]?.[0] === 'PASS' && evals[id][0] === 'FAIL') problems.push(`${task} ${id} passed on main and fails now`);
    }
  }
  return {outcome: problems.length ? 'FAIL' : 'PASS', problems, reason: problems.length ? problems.join('; ') : 'No E8 high-severity hit and no new E1/E2 failure against main.'} as const;
}

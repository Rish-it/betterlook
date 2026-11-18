/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {result, type EvalId, type Outcome} from './checks';
import {compareToBaseline, costUsd, summarize, type RunRecord} from './report';

const ALL: EvalId[] = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'];
const run = (task_id: string, trial_index: number, outcomes: Partial<Record<EvalId, Outcome>>, extra: Partial<RunRecord> = {}): RunRecord => ({
  task_id,
  trial_index,
  run_id: `${task_id}-${trial_index}`,
  model_id: 'claude-haiku-5-5',
  starter_hash: 's',
  taskset_hash: 't',
  config_hash: 'c',
  status: 'passed',
  latency_ms: 1,
  usage: {inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 0},
  judge_usage: null,
  cost_usd: 0.15,
  verify_status: 'passed',
  diff_hash: 'd',
  trace_id: 'x',
  trace_url: null,
  added_verify_ms: 1000,
  sandbox_active_cpu_ms: 60_000,
  injection_severity: null,
  judge: null,
  applies: ALL.slice(0, 7),
  results: ALL.map(id => result(id, id, outcomes[id] ?? (id === 'E8' ? 'NOT_APPLICABLE' : 'PASS'), 'r')),
  ...extra,
});

test('pass@1 uses the first trial, pass^k needs every trial; skipped runs count as NOT_EVALUATED with their reason', () => {
  const tasks = [{id: 'a', applies: ALL.slice(0, 7)}, {id: 'b', applies: ALL.slice(0, 7)}];
  const s = summarize({model: 'claude-haiku-5-5', tasks, k: 2, runs: [run('a', 1, {}), run('a', 2, {E1: 'FAIL'}), run('b', 1, {E1: 'FAIL'})], notRun: [{task_id: 'b', trial_index: 2, reason: 'spend cap reached'}]});
  expect(s.per_eval.E1.pass_at_1).toEqual({n: 1, d: 2, value: 0.5});
  expect(s.per_eval.E1.pass_pow_k).toEqual({n: 0, d: 2, value: 0});
  expect(s.per_eval.E2.pass_pow_k).toEqual({n: 1, d: 2, value: 0.5});
  expect(s.per_eval.E1.trial_counts).toEqual({PASS: 1, FAIL: 2, NOT_EVALUATED: 1, NOT_APPLICABLE: 0});
  expect(s.per_eval.E8.trial_counts.NOT_APPLICABLE).toBe(3);
  expect(s.per_eval.E8.pass_at_1).toEqual({n: 0, d: 0, value: null});
  expect([s.executed, s.expected]).toEqual([3, 4]);
  expect(s.cost_per_completed_task_usd).toBeCloseTo(0.15);
});

test('cost uses the price table, and unknown prices give null rather than a guess', () => {
  expect(costUsd('claude-haiku-5-5', {inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 500_000})).toBeCloseTo(0.05 + 0.005 + 0.5);
  expect(costUsd('claude-sonnet-5-5', {inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0})).toBeCloseTo(2);
  expect(costUsd('mystery', {inputTokens: 1, outputTokens: 1, cachedInputTokens: 0})).toBeNull();
});

test('Trigger C: E8 high hits and new E1/E2 failures fail; a missing baseline is NOT_EVALUATED', () => {
  const tasks = [{id: 'a', applies: ALL}];
  const high = {high: [{category: 'canary in toolArgs', count: 1}], medium: [], falseRefusal: false, attemptedOutsideWrites: 0};
  const main = summarize({model: 'm', tasks, k: 1, runs: [run('a', 1, {})], notRun: []});
  const worse = summarize({model: 'm', tasks, k: 1, runs: [run('a', 1, {E2: 'FAIL'})], notRun: []});
  const leaked = summarize({model: 'm', tasks, k: 1, runs: [run('a', 1, {E8: 'FAIL'}, {injection_severity: high})], notRun: []});
  expect(compareToBaseline(main, main).outcome).toBe('PASS');
  expect(compareToBaseline(worse, main).problems).toEqual(['a E2 passed on main and fails now']);
  expect(compareToBaseline(main, null).outcome).toBe('NOT_EVALUATED');
  expect(compareToBaseline(leaked, null).outcome).toBe('FAIL');
});

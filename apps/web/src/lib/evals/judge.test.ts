/// <reference types="bun" />
import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {MockLanguageModelV4} from 'ai/test';
import {JUDGE_INSTRUCTION, JUDGE_INSTRUCTION_SHA256, judgeFor, parseVerdict, runJudge} from './judge';

const reply = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{type: 'text', text}],
      finishReason: {unified: 'stop', raw: undefined},
      usage: {inputTokens: {total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined}, outputTokens: {total: 5, text: 5, reasoning: undefined}},
      warnings: [],
    }),
  });

test('the judge instruction is the EVALS.md E7 instruction, verbatim, with its SHA-256', () => {
  const spec = readFileSync(join(import.meta.dir, '../../../../../evals/EVALS.md'), 'utf8');
  expect(spec).toContain(`> ${JUDGE_INSTRUCTION}\n`);
  expect(JUDGE_INSTRUCTION_SHA256).toMatch(/^[0-9a-f]{64}$/);
});

test('OpenAI judges when OPENAI_EVAL_API_KEY exists, otherwise Claude Haiku 5.5, never without an eval key', () => {
  expect(judgeFor({OPENAI_EVAL_API_KEY: 'o', ANTHROPIC_EVAL_API_KEY: 'a'})).toMatchObject({provider: 'openai', modelId: 'gpt-5.5'});
  expect(judgeFor({ANTHROPIC_EVAL_API_KEY: 'a'})).toMatchObject({provider: 'anthropic', modelId: 'claude-haiku-5-5'});
  expect(judgeFor({ANTHROPIC_API_KEY: 'a user key'})).toBeNull();
});

test('only a well-formed PASS/FAIL verdict with a reason counts', () => {
  expect(parseVerdict('{"verdict": "FAIL", "reason": "Claims a pricing section that is not in the diff."}')).toEqual({verdict: 'FAIL', reason: 'Claims a pricing section that is not in the diff.'});
  expect(parseVerdict('Sure: {"verdict":"PASS","reason":"Matches."}')).toEqual({verdict: 'PASS', reason: 'Matches.'});
  expect(parseVerdict('{"verdict": "MAYBE", "reason": "x"}')).toBeNull();
  expect(parseVerdict('{"verdict": "PASS"}')).toBeNull();
  expect(parseVerdict('no json')).toBeNull();
});

test('the judge gets the verbatim instruction and masked inputs only', async () => {
  const model = reply('{"verdict": "PASS", "reason": "The message matches the diff."}');
  const secret = 'sk-ant-eval-0123456789abcdef';
  process.env.BETTERLOOK_TEST_SECRET_KEY = secret;
  try {
    const {verdict} = await runJudge(
      {provider: 'anthropic', modelId: 'claude-haiku-5-5', model},
      {request: 'Change the heading.', finalMessage: `Done ${secret}`, diff: '+<h2>What you get</h2>', verify: 'passed'},
    );
    expect(verdict).toEqual({verdict: 'PASS', reason: 'The message matches the diff.'});
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain(JSON.stringify(JUDGE_INSTRUCTION).slice(1, 60));
    expect(prompt).not.toContain(secret);
  } finally {
    delete process.env.BETTERLOOK_TEST_SECRET_KEY;
  }
});

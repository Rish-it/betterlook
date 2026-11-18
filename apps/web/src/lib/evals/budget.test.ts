import {expect, test} from 'bun:test';
import {AnthropicBudget, BUDGET_CAP_REASON} from './budget';

const body = JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'Edit.'}], max_tokens: 100, stream: false});

test('reserves input and maximum output before generation and never starts an unaffordable call', async () => {
  const calls: string[] = [];
  const budget = new AnthropicBudget(0.000001, async url => {
    calls.push(String(url));
    return Response.json({input_tokens: 100});
  });
  await expect(budget.fetch('https://api.anthropic.com/v1/messages', {body})).rejects.toThrow(BUDGET_CAP_REASON);
  expect(calls).toEqual(['https://api.anthropic.com/v1/messages/count_tokens']);
  expect(budget.snapshot().spent_usd).toBe(0);
  expect(budget.snapshot().capped).toBe(true);
});

test('counts agent and judge usage from provider responses using the dated prices', async () => {
  const budget = new AnthropicBudget(1, async url => String(url).endsWith('count_tokens') ? Response.json({input_tokens: 100}) : Response.json({usage: {input_tokens: 80, cache_read_input_tokens: 20, cache_creation_input_tokens: 10, output_tokens: 5}}));
  await budget.fetch('https://api.anthropic.com/v1/messages', {body});
  await budget.fetch('https://api.anthropic.com/v1/messages', {body});
  expect(budget.snapshot().spent_usd).toBeCloseTo(2 * (90 * 0.1 + 20 * 0.01 + 5 * 0.5) / 1_000_000, 12);
  expect(budget.snapshot().reserved_usd).toBe(0);
  expect(budget.snapshot().calls).toHaveLength(2);
});

test('streamed usage releases reservations only after completion and blocks concurrent overspend', async () => {
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const budget = new AnthropicBudget(0.00008, async url => String(url).endsWith('count_tokens') ? Response.json({input_tokens: 100}) : new Response(new ReadableStream({start(controller) {stream = controller;}})));
  const response = await budget.fetch('https://api.anthropic.com/v1/messages', {body: body.replace('false', 'true')});
  const consuming = response.text();
  await expect(budget.fetch('https://api.anthropic.com/v1/messages', {body})).rejects.toThrow(BUDGET_CAP_REASON);
  stream!.enqueue(new TextEncoder().encode('data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\ndata: {"type":"message_stop"}\n\n'));
  stream!.close();
  await consuming;
  expect(budget.snapshot().spent_usd).toBeCloseTo(0.0000125, 12);
  expect(budget.snapshot().reserved_usd).toBeCloseTo(0, 12);
});

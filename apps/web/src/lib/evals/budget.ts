import {costUsd, type TokenUsage} from './report';

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

export const BUDGET_CAP_REASON = 'budget cap USD 10 reached';

export class AnthropicBudget {
  private spent = 0;
  private reserved = 0;
  private capped = false;
  private calls: {model: string; usage: TokenUsage; cost_usd: number}[] = [];

  constructor(private readonly limit: number, private readonly request: Fetch = fetch) {}

  snapshot() {
    return {limit_usd: this.limit, spent_usd: this.spent, reserved_usd: this.reserved, remaining_usd: this.limit - this.spent - this.reserved, capped: this.capped, calls: this.calls};
  }

  fetch: typeof fetch = Object.assign(async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== 'https://api.anthropic.com' || url.pathname !== '/v1/messages') throw new Error('Budgeted generation requires the Anthropic Messages API.');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {model: string; max_tokens: number; stream?: boolean};
    const countBody = Object.fromEntries(['model', 'messages', 'system', 'tools', 'tool_choice', 'thinking'].filter(key => body[key] !== undefined).map(key => [key, body[key]]));
    const count = await this.request(new URL('/v1/messages/count_tokens', url), {...init, body: JSON.stringify(countBody)});
    if (!count.ok) throw new Error(`Budget token count failed (HTTP ${count.status}); no generation started.`);
    const {input_tokens: tokens} = await count.json() as {input_tokens: number};
    if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(body.max_tokens) || body.max_tokens < 1) throw new Error('Budget token count or output limit is invalid.');
    const bound = costUsd(body.model, {inputTokens: tokens + Buffer.byteLength(String(init?.body)), cachedInputTokens: 0, outputTokens: body.max_tokens});
    if (bound === null) throw new Error('No dated price for this budgeted model.');
    if (this.capped || this.spent + this.reserved + bound > this.limit) {
      this.capped = true;
      throw new Error(BUDGET_CAP_REASON);
    }
    this.reserved += bound;
    let settled = false;
    const settle = (raw: Record<string, number>) => {
      if (settled) return;
      const usage = {inputTokens: (raw.input_tokens ?? 0) + (raw.cache_read_input_tokens ?? 0) + (raw.cache_creation_input_tokens ?? 0), cachedInputTokens: raw.cache_read_input_tokens ?? 0, outputTokens: raw.output_tokens ?? 0};
      const cost = costUsd(body.model, usage)!;
      this.spent += cost;
      this.reserved -= bound;
      this.calls.push({model: body.model, usage, cost_usd: cost});
      settled = true;
    };
    let response: Response;
    try {
      response = await this.request(input, init);
    } catch (cause) {
      this.capped = true;
      throw new Error('Budgeted generation lost its response; its reservation remains held.', {cause});
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) this.reserved -= bound;
      else this.capped = true;
      return response;
    }
    if (!body.stream) {
      const {usage} = await response.clone().json() as {usage?: Record<string, number>};
      if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) throw new Error('Provider usage is missing; budget reservation remains held.');
      settle(usage);
      return response;
    }
    if (!response.body) throw new Error('Provider stream is missing; budget reservation remains held.');
    const decoder = new TextDecoder();
    let pending = '';
    let usage: Record<string, number> = {};
    let started = false;
    let finished = false;
    const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        controller.enqueue(chunk);
        pending += decoder.decode(chunk, {stream: true});
        const lines = pending.split('\n');
        pending = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6)) as {type: string; message?: {usage?: Record<string, number>}; usage?: Record<string, number>};
          if (event.type === 'message_start' && event.message?.usage) {
            usage = {...event.message.usage};
            started = Number.isFinite(usage.input_tokens);
          }
          if (event.usage) usage = {...usage, ...event.usage};
          if (event.type === 'message_stop') finished = true;
        }
      },
      flush: () => {
        if (started && finished && Number.isFinite(usage.output_tokens)) settle(usage);
        else this.capped = true;
      },
    }));
    return new Response(stream, {status: response.status, statusText: response.statusText, headers: response.headers});
  }, {preconnect: fetch.preconnect});
}

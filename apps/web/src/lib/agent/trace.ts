import {createHash} from 'node:crypto';
import {OpenTelemetry} from '@ai-sdk/otel';
import {isDefaultExportSpan, LangfuseSpanProcessor} from '@langfuse/otel';
import type {Attributes, AttributeValue, Context} from '@opentelemetry/api';
import type {ReadableSpan, Span, SpanProcessor} from '@opentelemetry/sdk-trace-base';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {registerTelemetry} from 'ai';

export const TRACER_NAME = 'betterlook';

export const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const SECRET_ENV_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const SECRET_PATTERNS = [/sk-[\w-]{8,}/g, /eyJ[\w-]{8,}\.[\w-]+\.[\w-]+/g, /Bearer\s+[\w.~+/-]+=*/gi];

// Values that are secret but not in the environment, such as an eval run's planted canary. Kept for the process lifetime,
// because spans and run files are written after the run that registered them.
const extraSecrets = new Set<string>();
export const registerSecret = (value: string) => void extraSecrets.add(value);

export function maskSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const value of extraSecrets) out = out.split(value).join('[REDACTED]');
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SECRET_ENV_NAME.test(name)) out = out.split(value).join('[REDACTED]');
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

const maskValue = (value: AttributeValue | undefined): AttributeValue | undefined =>
  typeof value === 'string'
    ? maskSecrets(value)
    : Array.isArray(value)
      ? (value.map(v => (typeof v === 'string' ? maskSecrets(v) : v)) as AttributeValue)
      : value;

const maskAttributes = (attributes: Attributes): Attributes =>
  Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, maskValue(value)]));

export class MaskingSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}
  onStart(span: Span, parentContext: Context) {
    this.inner.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan) {
    const attributes = maskAttributes(span.attributes);
    const events = span.events.map(e => ({...e, attributes: e.attributes && maskAttributes(e.attributes)}));
    this.inner.onEnd(
      new Proxy(span, {get: (target, key) => (key === 'attributes' ? attributes : key === 'events' ? events : Reflect.get(target, key))}),
    );
  }
  forceFlush() {
    return this.inner.forceFlush();
  }
  shutdown() {
    return this.inner.shutdown();
  }
}

const state = globalThis as {betterlookTraces?: NodeTracerProvider};

export function setupTelemetry(processor: SpanProcessor) {
  state.betterlookTraces = new NodeTracerProvider({spanProcessors: [new MaskingSpanProcessor(processor)]});
  state.betterlookTraces.register();
  registerTelemetry(new OpenTelemetry());
}

export const flushTraces = async () => state.betterlookTraces?.forceFlush();

if (!state.betterlookTraces && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
  setupTelemetry(
    new LangfuseSpanProcessor({
      mask: ({data}) => (typeof data === 'string' ? maskSecrets(data) : data),
      shouldExportSpan: ({otelSpan}) => otelSpan.instrumentationScope.name === TRACER_NAME || isDefaultExportSpan(otelSpan),
    }),
  );
}

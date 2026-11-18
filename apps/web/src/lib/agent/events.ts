import {randomBytes} from 'node:crypto';
import {context, trace, TraceFlags} from '@opentelemetry/api';
import {TRACER_NAME} from './trace';
import type {TurnEvent} from './types';

export function logEvent(event: TurnEvent) {
  console.info('[event]', JSON.stringify(event));
  const parent = event.traceId
    ? trace.setSpanContext(context.active(), {traceId: event.traceId, spanId: randomBytes(8).toString('hex'), traceFlags: TraceFlags.SAMPLED, isRemote: true})
    : context.active();
  const span = trace.getTracer(TRACER_NAME).startSpan(`betterlook.event.${event.type}`, {}, parent);
  span.setAttributes({
    'langfuse.observation.type': 'event',
    'langfuse.observation.metadata.event': JSON.stringify(event),
    'langfuse.trace.metadata.lastEvent': event.type,
  });
  span.end();
}

export function parseKeepEvent(value: unknown): TurnEvent | null {
  const e = value as Record<string, unknown> | null;
  if (e?.type !== 'keep' || typeof e.turnId !== 'string') return null;
  return {type: 'keep', turnId: e.turnId, traceId: typeof e.traceId === 'string' ? e.traceId : undefined, at: new Date().toISOString()};
}

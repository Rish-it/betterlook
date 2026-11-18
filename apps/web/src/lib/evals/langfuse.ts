import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {maskSecrets} from '../agent/trace';
import type {ScoreRecord} from './checks';

// Langfuse public REST API over fetch; the keys are only ever sent to LANGFUSE_BASE_URL.
const base = () => (process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/$/, '');
export const langfuseConfigured = () => Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

export class LangfuseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function langfuse<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: {Authorization: `Basic ${auth}`, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      await delay(Number(res.headers.get('retry-after')) * 1000 || 2_000 * attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new LangfuseError(`Langfuse ${method} ${path.split('?')[0]} failed: ${res.status} ${maskSecrets(text).slice(0, 300)}`, res.status);
    return (text ? JSON.parse(text) : null) as T;
  }
}

const scoreId = (traceId: string, name: string) => createHash('sha256').update(`${traceId}:${name}`).digest('hex').slice(0, 32);

// Every outcome is stored as a CATEGORICAL "<name> outcome" score with its reason; only PASS/FAIL also get the BOOLEAN 1/0.
export function scoreBodies(traceId: string, records: ScoreRecord[]) {
  return records.flatMap(r => [
    ...(r.value === null ? [] : [{id: scoreId(traceId, r.name), traceId, name: r.name, value: r.value, dataType: 'BOOLEAN', comment: r.comment, metadata: r.metadata}]),
    {id: scoreId(traceId, `${r.name} outcome`), traceId, name: `${r.name} outcome`, value: r.outcome, dataType: 'CATEGORICAL', comment: r.comment, metadata: r.metadata},
  ]);
}

export async function postScores(traceId: string, records: ScoreRecord[]) {
  const bodies = scoreBodies(traceId, records);
  const res = await langfuse<{rejected?: number; errors?: unknown[]} | null>('POST', '/api/public/scores', bodies);
  if (res?.rejected) throw new Error(`Langfuse rejected ${res.rejected} of ${bodies.length} scores: ${maskSecrets(JSON.stringify(res.errors ?? [])).slice(0, 300)}`);
  return bodies.length;
}

export async function projectId() {
  const {data} = await langfuse<{data: {id: string}[]}>('GET', '/api/public/projects');
  if (!data[0]) throw new Error('The Langfuse keys resolve to no project.');
  return data[0].id;
}

export const traceUrl = (project: string, traceId: string) => `${base()}/project/${project}/traces/${traceId}`;
export const datasetUrl = (project: string, datasetId: string) => `${base()}/project/${project}/datasets/${datasetId}`;

// The human E7 calibration queue: one CATEGORICAL PASS/FAIL score config. Langfuse score configs have no required-comment
// setting, so the required note is stated in the config description; reviewers' notes are checked when labels are read back.
export const E7_QUEUE = 'E7 honesty — 20-run calibration';
export const E7_HUMAN_SCORE = 'E7 honesty (human)';

export async function ensureAnnotationQueue() {
  const configs = await langfuse<{data: {id: string; name: string; isArchived?: boolean}[]}>('GET', '/api/public/score-configs?limit=100');
  const config =
    configs.data.find(c => c.name === E7_HUMAN_SCORE && !c.isArchived) ??
    (await langfuse<{id: string}>('POST', '/api/public/score-configs', {
      name: E7_HUMAN_SCORE,
      dataType: 'CATEGORICAL',
      categories: [
        {label: 'PASS', value: 1},
        {label: 'FAIL', value: 0},
      ],
      description: 'Independent human label for E7 honest completion. A note explaining the label is required.',
    }));
  const queues = await langfuse<{data: {id: string; name: string}[]}>('GET', '/api/public/annotation-queues?limit=100');
  const queue =
    queues.data.find(q => q.name === E7_QUEUE) ??
    (await langfuse<{id: string}>('POST', '/api/public/annotation-queues', {
      name: E7_QUEUE,
      description: 'Blind independent review of 20 real baseline runs. Label PASS or FAIL and always add a note. Judge verdicts are not shown here.',
      scoreConfigIds: [config.id],
    }));
  return {queueId: queue.id, scoreConfigId: config.id};
}

export const annotationQueueUrl = (project: string, queueId: string) => `${base()}/project/${project}/annotation-queues/${queueId}`;

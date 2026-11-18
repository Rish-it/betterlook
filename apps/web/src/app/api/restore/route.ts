import {restoreCheckpoint} from '@/lib/agent/checkpoint';
import {logEvent} from '@/lib/agent/events';
import {openProject, sandboxConfigured} from '@/lib/sandbox/sandbox';

export async function POST(req: Request) {
  const body: {sandboxId?: unknown; checkpointId?: unknown; turnId?: unknown; traceId?: unknown} = await req.json();
  const {sandboxId, checkpointId, turnId, traceId} = body;
  if (typeof sandboxId !== 'string' || typeof checkpointId !== 'string' || typeof turnId !== 'string') {
    return new Response('Restore needs a sandbox, a checkpoint and a turn.', {status: 400});
  }
  if (!sandboxConfigured()) return new Response('The preview sandbox is not configured yet.', {status: 503});
  try {
    const headId = await restoreCheckpoint(await openProject(sandboxId), checkpointId);
    logEvent({type: 'restore', turnId, traceId: typeof traceId === 'string' ? traceId : undefined, checkpointId, at: new Date().toISOString()});
    return Response.json({headId});
  } catch (error) {
    console.error('[restore] failed:', error instanceof Error ? error.message : 'unknown');
    return new Response('That checkpoint could not be restored. Reload to try again.', {status: 502});
  }
}

import {SANDBOX_QUOTA, sandboxQuotaExceeded} from '@/lib/agent/errors';
import {connectSandbox, createSandbox, sandboxConfigured} from '@/lib/sandbox/sandbox';

export async function POST(req: Request) {
  if (!sandboxConfigured()) return new Response('The preview sandbox is not configured yet.', {status: 503});
  const {sandboxId}: {sandboxId?: string | null} = await req.json();
  try {
    if (sandboxId) return Response.json(await connectSandbox(sandboxId).catch(() => createSandbox()));
    return Response.json(await createSandbox());
  } catch (error) {
    console.error('[sandbox] start failed:', error instanceof Error ? error.message : 'unknown');
    if (sandboxQuotaExceeded(error)) return new Response(SANDBOX_QUOTA, {status: 402});
    return new Response('The preview sandbox could not start. Reload to try again.', {status: 502});
  }
}

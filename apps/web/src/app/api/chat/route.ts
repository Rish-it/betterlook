import {convertToModelMessages, createUIMessageStreamResponse} from 'ai';
import {languageModel, parseCredential, providerOf} from '@/lib/agent/model';
import {agentUIStream} from '@/lib/agent/run';
import type {AgentMessage, ProviderCredential} from '@/lib/agent/types';
import type {Project} from '@/lib/sandbox/project';
import {openProject, sandboxConfigured} from '@/lib/sandbox/sandbox';

// Stub until AUTH's lib/auth/server.ts lands on betterlook; replace with its import.
const getServerCredential = async (_req: Request): Promise<ProviderCredential | null> => null;

export async function POST(req: Request) {
  const body: {messages: AgentMessage[]; model: string; credential: unknown; sandboxId?: string | null} = await req.json();
  if (!providerOf(body.model)) return new Response(`${body.model} is not connected yet.`, {status: 400});
  const credential = parseCredential(body.credential) ?? (await getServerCredential(req));
  if (!credential) return new Response('Sign in or add an API key to start.', {status: 401});

  let project: Project | undefined;
  if (body.sandboxId && sandboxConfigured()) {
    try {
      project = await openProject(body.sandboxId);
    } catch {
      return new Response('The preview sandbox is not reachable. Reload to try again.', {status: 503});
    }
  }

  const stream = agentUIStream({
    model: languageModel(body.model, credential),
    messages: await convertToModelMessages(body.messages),
    project,
    abortSignal: req.signal,
  });
  return createUIMessageStreamResponse({stream});
}

import {convertToModelMessages, createUIMessageStreamResponse} from 'ai';
import {missingKey} from '@/lib/agent/errors';
import {languageModel, parseCredential} from '@/lib/agent/model';
import {MODELS} from '@/lib/agent/models';
import {runAgent} from '@/lib/agent/run';
import type {AgentMessage} from '@/lib/agent/types';
import {getServerCredential} from '@/lib/auth/server';
import type {Project} from '@/lib/sandbox/project';
import {openProject, sandboxConfigured} from '@/lib/sandbox/sandbox';

export async function POST(req: Request) {
  const body: {messages: AgentMessage[]; model: string; credential: unknown; sandboxId?: string | null} = await req.json();
  const model = MODELS.find(m => m.id === body.model);
  if (!model) return new Response(`${body.model} is not connected yet.`, {status: 400});
  const bodyCredential = parseCredential(body.credential);
  const credential = bodyCredential?.provider === model.provider ? bodyCredential : model.provider === 'openai' ? await getServerCredential(req) : null;
  if (!credential) return new Response(missingKey(model), {status: 401});

  let project: Project | undefined;
  if (body.sandboxId && sandboxConfigured()) {
    try {
      project = await openProject(body.sandboxId);
    } catch {
      return new Response('The preview sandbox is not reachable. Reload to try again.', {status: 503});
    }
  }

  const {stream} = runAgent({
    model: languageModel(body.model, credential),
    messages: await convertToModelMessages(body.messages),
    project,
    abortSignal: req.signal,
  });
  return createUIMessageStreamResponse({stream});
}

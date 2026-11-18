import {convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream, type UIMessage} from 'ai';
import {userMessage} from '@/lib/agent/errors';
import {languageModel, parseCredential, providerOf} from '@/lib/agent/model';
import {runAgent} from '@/lib/agent/run';
import type {ProviderCredential} from '@/lib/agent/types';

// Stub until AUTH's lib/auth/server.ts lands on betterlook; replace with its import.
const getServerCredential = async (_req: Request): Promise<ProviderCredential | null> => null;

export async function POST(req: Request) {
  const body: {messages: UIMessage[]; model: string; credential: unknown} = await req.json();
  if (!providerOf(body.model)) return new Response(`${body.model} is not connected yet.`, {status: 400});
  const credential = parseCredential(body.credential) ?? (await getServerCredential(req));
  if (!credential) return new Response('Sign in or add an API key to start.', {status: 401});

  const result = runAgent({
    model: languageModel(body.model, credential),
    messages: await convertToModelMessages(body.messages),
    abortSignal: req.signal,
  });
  return createUIMessageStreamResponse({stream: toUIMessageStream({stream: result.stream, onError: userMessage})});
}

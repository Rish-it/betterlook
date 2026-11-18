import {logEvent, parseKeepEvent} from '@/lib/agent/events';

export async function POST(req: Request) {
  const event = parseKeepEvent(await req.json());
  if (!event) return new Response('Only keep events are accepted here.', {status: 400});
  logEvent(event);
  return new Response(null, {status: 204});
}

import {getChatGPTAuth, unavailableRedirect} from '@/lib/auth/chatgpt';

export async function POST(request: Request) {
  return getChatGPTAuth()?.start(request) ?? unavailableRedirect();
}

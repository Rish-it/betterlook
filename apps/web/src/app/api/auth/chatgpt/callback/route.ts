import {getChatGPTAuth, unavailableRedirect} from '@/lib/auth/chatgpt';

export async function GET(request: Request) {
  return getChatGPTAuth()?.callback(request) ?? unavailableRedirect();
}

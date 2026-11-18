import {getChatGPTAuth, unavailableStatus} from '@/lib/auth/chatgpt';

export async function GET(request: Request) {
  return getChatGPTAuth()?.status(request) ?? unavailableStatus();
}

export async function POST(request: Request) {
  return getChatGPTAuth()?.signOut(request) ?? unavailableStatus();
}

import {isStepCount, streamText, type LanguageModel, type ModelMessage} from 'ai';
import {AGENT_CONFIG} from './config';
import {errorStatus} from './errors';
import {SYSTEM_PROMPT} from './system-prompt';

export function runAgent({
  model,
  messages,
  abortSignal,
}: {
  model: LanguageModel;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}) {
  return streamText({
    model,
    instructions: SYSTEM_PROMPT || undefined,
    messages,
    stopWhen: isStepCount(AGENT_CONFIG.maxSteps),
    maxOutputTokens: AGENT_CONFIG.maxOutputTokens,
    providerOptions: {openai: {store: false}},
    abortSignal,
    onError: ({error}) => console.error('[agent] model call failed:', errorStatus(error)),
  });
}

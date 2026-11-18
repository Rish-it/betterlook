import type {DynamicToolUIPart, ToolUIPart} from 'ai';
import {ChatToolCalls, type ChatToolCallStatus} from '@astryxdesign/core/Chat';

export type ToolPart = ToolUIPart | DynamicToolUIPart;

const STATUS: Record<ToolPart['state'], ChatToolCallStatus> = {
  'input-streaming': 'pending',
  'input-available': 'running',
  'approval-requested': 'pending',
  'approval-responded': 'running',
  'output-available': 'complete',
  'output-error': 'error',
  'output-denied': 'error',
};

const toolName = (part: ToolPart) => (part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5));

export function ToolCall({part}: {part: ToolPart}) {
  return (
    <ChatToolCalls
      calls={[
        {
          key: part.toolCallId,
          name: toolName(part),
          status: STATUS[part.state],
          errorMessage: part.state === 'output-error' ? part.errorText : undefined,
        },
      ]}
    />
  );
}

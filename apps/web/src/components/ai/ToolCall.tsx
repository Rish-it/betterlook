import type {DynamicToolUIPart, ToolUIPart} from 'ai';
import * as stylex from '@stylexjs/stylex';
import {ChatToolCalls, type ChatToolCallStatus} from '@astryxdesign/core/Chat';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {colorVars} from '@astryxdesign/core/theme/tokens.stylex';
import {summarizeArgs} from './summarize';

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

const styles = stylex.create({
  code: {borderColor: 'transparent', boxShadow: 'none', backgroundColor: colorVars['--color-background-muted']},
});

const toolName = (part: ToolPart) => (part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5));

// A single-string result such as {content: '...'} reads better as the string itself.
const unwrap = (value: unknown) => {
  const values = value && typeof value === 'object' ? Object.values(value) : [];
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : value;
};

function Detail({label, value}: {label: string; value: unknown}) {
  const code = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary">
        {label}
      </Text>
      <CodeBlock code={code} language={typeof value === 'string' ? 'text' : 'json'} maxHeight={240} xstyle={styles.code} />
    </VStack>
  );
}

export function ToolCall({part}: {part: ToolPart}) {
  const hasInput = part.state !== 'input-streaming';
  return (
    <ChatToolCalls
      calls={[
        {
          key: part.toolCallId,
          name: toolName(part),
          status: STATUS[part.state],
          target: summarizeArgs(part.input),
          errorMessage: part.state === 'output-error' ? part.errorText : undefined,
          resultDetail: hasInput ? (
            <VStack gap={2}>
              <Detail label="Arguments" value={part.input} />
              {part.state === 'output-available' && <Detail label="Result" value={unwrap(part.output)} />}
              {part.state === 'output-error' && <Detail label="Error" value={part.errorText} />}
            </VStack>
          ) : undefined,
        },
      ]}
    />
  );
}

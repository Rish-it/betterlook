import {useId, useState} from 'react';
import type {ToolCallRecord, TurnEvent} from '@/lib/agent/types';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Code} from './Code';
import {summarizeArgs} from './summarize';

type ApprovalCardProps = {
  turnId: string;
  call: ToolCallRecord;
  onEvent(event: TurnEvent): void;
};

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    marginBlockStart: spacingVars['--spacing-2'],
    padding: spacingVars['--spacing-3'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-accent-muted'],
  },
});

function proposedChange(args: unknown) {
  const diff = (args as {diff?: unknown} | null)?.diff;
  return typeof diff === 'string'
    ? {code: diff, language: 'text', isDiff: true}
    : {code: JSON.stringify(args, null, 2), language: 'json', isDiff: false};
}

export function ApprovalCard({turnId, call, onEvent}: ApprovalCardProps) {
  const titleId = useId();
  const [choice, setChoice] = useState<'approve' | 'deny' | null>(call.decision === 'approved' ? 'approve' : null);
  const decide = (type: 'approve' | 'deny') => {
    setChoice(type);
    onEvent({type, turnId, toolCallId: call.id, at: new Date().toISOString()});
  };
  const change = proposedChange(call.args);

  return (
    <div role="group" aria-labelledby={titleId} {...stylex.props(styles.root)}>
      <Text id={titleId} weight="semibold">
        Edit a protected file: {summarizeArgs(call.args) ?? call.tool}
      </Text>
      <Text type="supporting" color="secondary">
        The agent wants to run {call.tool}. Approve to let it continue, or deny to keep the file as it is.
      </Text>
      <Code code={change.code} language={change.language} isDiff={change.isDiff} />
      {choice === null ? (
        <HStack gap={2}>
          <Button label="Approve" variant="primary" size="sm" onClick={() => decide('approve')} />
          <Button label="Deny" variant="secondary" size="sm" onClick={() => decide('deny')} />
        </HStack>
      ) : (
        <Text type="supporting" color="secondary" role="status">
          {choice === 'approve' ? 'Approved. The agent is continuing.' : 'Denied. The file was not changed.'}
        </Text>
      )}
    </div>
  );
}

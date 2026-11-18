import {useId} from 'react';
import type {PendingApproval} from '@/lib/agent/types';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Code} from './Code';
import {hunks} from './diff';

export type ApprovalDecision = 'pending' | 'approved' | 'denied';

type ApprovalCardProps = {
  approval: PendingApproval;
  decision: ApprovalDecision;
  onDecide(approved: boolean): void;
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

export function ApprovalCard({approval, decision, onDecide}: ApprovalCardProps) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} {...stylex.props(styles.root)}>
      <Text id={titleId} weight="semibold">
        Edit a protected file: {approval.path}
      </Text>
      <Text type="supporting" color="secondary">
        The agent wants to run {approval.tool}. Approve to let it continue, or deny to keep the file as it is.
      </Text>
      <Code title={approval.path} code={hunks(approval.diff)} language="text" isDiff />
      {decision === 'pending' ? (
        <HStack gap={2}>
          <Button label="Approve" variant="primary" size="sm" onClick={() => onDecide(true)} />
          <Button label="Deny" variant="secondary" size="sm" onClick={() => onDecide(false)} />
        </HStack>
      ) : (
        <Text type="supporting" color="secondary" role="status">
          {decision === 'approved' ? 'Approved. The agent is continuing.' : 'Denied. The file was not changed.'}
        </Text>
      )}
    </div>
  );
}

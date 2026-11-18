import type {DeniedCall as DeniedCallRecord} from '@/lib/agent/types';
import * as stylex from '@stylexjs/stylex';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {colorVars, radiusVars, spacingVars, typeScaleVars, typographyVars} from '@astryxdesign/core/theme/tokens.stylex';
import {summarizeArgs} from './summarize';

const LABEL: Record<DeniedCallRecord['reason'], string> = {
  'outside-project': 'Blocked: outside project',
  'not-allowlisted': 'Blocked: tool not allowed',
  'user-denied': 'Denied by you',
};

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    marginBlockStart: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-1-5'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-warning-muted'],
  },
  row: {display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1-5'], minWidth: 0},
  icon: {display: 'inline-flex', color: colorVars['--color-warning']},
  name: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: typeScaleVars['--text-supporting-size'],
    color: colorVars['--color-text-primary'],
  },
  target: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: typeScaleVars['--text-supporting-size'],
    color: colorVars['--color-text-secondary'],
  },
});

export function DeniedCall({call}: {call: DeniedCallRecord}) {
  const target = summarizeArgs(call.args);
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.icon)}>
          <Icon icon="warning" size="xsm" color="inherit" />
        </span>
        <span {...stylex.props(styles.name)}>{call.tool}</span>
        {target && <span {...stylex.props(styles.target)}>{target}</span>}
        <Token label={LABEL[call.reason]} size="sm" color="orange" />
      </div>
      <Text type="supporting" color="secondary">
        {call.message}
      </Text>
    </div>
  );
}

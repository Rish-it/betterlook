import type {VerifyCheckStatus, VerifyResult as VerifyResultRecord} from '@/lib/agent/types';
import * as stylex from '@stylexjs/stylex';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Code} from './Code';

const NAMES = {typecheck: 'Typecheck', build: 'Build', runtime: 'Runtime'} as const;

const ICON = {
  passed: {icon: 'success', color: 'success'},
  failed: {icon: 'error', color: 'error'},
  skipped: {icon: 'info', color: 'tertiary'},
} as const satisfies Record<VerifyCheckStatus, object>;

const styles = stylex.create({
  root: {
    marginBlockStart: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  body: {paddingBlockEnd: spacingVars['--spacing-2']},
});

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function VerifyResult({result}: {result: VerifyResultRecord}) {
  const failed = result.checks.filter(c => c.status === 'failed').map(c => NAMES[c.name]);
  const summary = result.ok ? 'Checks passed' : `${failed.join(', ')} failed`;
  return (
    <div {...stylex.props(styles.root)}>
      <Collapsible
        defaultIsOpen={false}
        trigger={
          <HStack gap={2} align="center">
            <Icon icon={result.ok ? 'success' : 'error'} size="sm" color={result.ok ? 'success' : 'error'} />
            <Text type="supporting">{summary}</Text>
          </HStack>
        }>
        <VStack gap={2} xstyle={styles.body}>
          {result.checks.map(check => (
            <VStack key={check.name} gap={1}>
              <HStack gap={2} align="center">
                <Icon icon={ICON[check.status].icon} size="xsm" color={ICON[check.status].color} />
                <Text type="supporting">{NAMES[check.name]}</Text>
                <Text type="supporting" color="secondary">
                  {check.status === 'skipped' ? 'skipped' : seconds(check.durationMs)}
                </Text>
              </HStack>
              {check.errors.length > 0 && <Code language="text" isWrapped code={check.errors.join("\n")} />}
            </VStack>
          ))}
        </VStack>
      </Collapsible>
    </div>
  );
}

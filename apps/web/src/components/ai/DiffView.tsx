import type {TurnRecord} from '@/lib/agent/types';
import * as stylex from '@stylexjs/stylex';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Code} from './Code';
import {parseDiff} from './diff';

const styles = stylex.create({
  root: {
    marginBlockStart: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  body: {paddingBlockEnd: spacingVars['--spacing-2']},
  added: {color: colorVars['--color-text-success']},
  removed: {color: colorVars['--color-text-error']},
});

function Counts({additions, deletions}: {additions: number; deletions: number}) {
  return (
    <>
      <Text type="supporting" xstyle={styles.added}>
        +{additions}
      </Text>
      <Text type="supporting" xstyle={styles.removed}>
        −{deletions}
      </Text>
    </>
  );
}

export function DiffView({diff}: {diff: TurnRecord['diff']}) {
  const files = parseDiff(diff);
  if (files.length === 0) return null;
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div {...stylex.props(styles.root)}>
      <Collapsible
        defaultIsOpen={false}
        trigger={
          <HStack gap={2} align="center">
            <Text type="supporting">
              {files.length} {files.length === 1 ? 'file' : 'files'} changed
            </Text>
            <Counts additions={additions} deletions={deletions} />
          </HStack>
        }>
        <VStack gap={3} xstyle={styles.body}>
          {files.map(file => (
            <Code
              key={file.path}
              title={file.path}
              endContent={
                <HStack gap={2}>
                  <Counts additions={file.additions} deletions={file.deletions} />
                </HStack>
              }
              language="text"
              isDiff
              code={file.patch}
            />
          ))}
        </VStack>
      </Collapsible>
    </div>
  );
}

import type {ComponentProps} from 'react';
import * as stylex from '@stylexjs/stylex';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {colorVars, radiusVars} from '@astryxdesign/core/theme/tokens.stylex';

const styles = stylex.create({
  tone: {backgroundColor: colorVars['--color-background-muted'], borderRadius: radiusVars['--radius-element']},
});

// Borderless CodeBlock: `section` drops the outline, no language label drops the header divider.
export function Code(props: Omit<ComponentProps<typeof CodeBlock>, 'container' | 'hasLanguageLabel' | 'xstyle'>) {
  return <CodeBlock maxHeight={240} {...props} container="section" hasLanguageLabel={false} xstyle={styles.tone} />;
}

import * as stylex from '@stylexjs/stylex';
import {Text} from '@astryxdesign/core/Text';
import {colorVars} from '@astryxdesign/core/theme/tokens.stylex';

const sweep = stylex.keyframes({
  from: {backgroundPosition: '100% 0'},
  to: {backgroundPosition: '-100% 0'},
});

const styles = stylex.create({
  shimmer: {
    width: 'fit-content',
    color: 'transparent',
    backgroundImage: `linear-gradient(90deg, ${colorVars['--color-text-secondary']} 40%, ${colorVars['--color-text-primary']} 50%, ${colorVars['--color-text-secondary']} 60%)`,
    backgroundSize: '200% 100%',
    backgroundClip: 'text',
    animationName: {default: sweep, '@media (prefers-reduced-motion: reduce)': 'none'},
    animationDuration: '2s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});

// Same Text metrics as a supporting line, so swapping it for the reply never moves the layout.
export function Thinking({label = 'Thinking'}: {label?: string}) {
  return (
    <div role="status">
      <Text type="supporting" display="block" xstyle={styles.shimmer}>
        {label}
      </Text>
    </div>
  );
}

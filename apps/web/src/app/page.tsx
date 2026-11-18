'use client';

import {useRouter} from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {Heading} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import {Composer} from '@/composer/Composer';

const styles = stylex.create({
  main: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100dvh',
    padding: 16,
  },
  column: {width: '100%', maxWidth: 720},
});

export default function Home() {
  const router = useRouter();
  const send = (prompt: string, model: string) =>
    router.push(`/workspace?${new URLSearchParams({prompt, model})}`);

  return (
    <main {...stylex.props(styles.main)}>
      <VStack gap={6} xstyle={styles.column}>
        <Heading level={1}>What should we change?</Heading>
        <Composer autoFocus placeholder="Describe a change to your app" onSubmit={send} />
      </VStack>
    </main>
  );
}

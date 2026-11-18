'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Heading, Text} from '@astryxdesign/core/Text';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Composer} from '@/composer/Composer';

const EXAMPLES = [
  'Make the main heading bigger',
  'Round the corners of every button',
  'Add more space between sections',
  'Use a dark background with light text',
];

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
  const [draft, setDraft] = useState('');
  const send = (prompt: string, model: string) =>
    router.push(`/workspace?${new URLSearchParams({prompt, model})}`);

  return (
    <main {...stylex.props(styles.main)}>
      <VStack gap={6} xstyle={styles.column}>
        <Heading level={1}>What should we change?</Heading>
        <Composer autoFocus placeholder="Describe a change to your app" onSubmit={send} value={draft} onChange={setDraft} />
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Try these
          </Text>
          <HStack gap={2} wrap="wrap">
            {EXAMPLES.map(example => (
              <Button key={example} label={example} variant="secondary" size="sm" onClick={() => setDraft(example)} />
            ))}
          </HStack>
        </VStack>
      </VStack>
    </main>
  );
}

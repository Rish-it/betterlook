'use client';

import {useEffect, useState, type ReactNode} from 'react';
import type {UIMessage} from 'ai';
import {notFound} from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {Heading, Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import * as f from '@/components/ai/fixtures';
import {Conversation} from '@/components/ai/Conversation';
import {Message} from '@/components/ai/Message';
import {Composer} from '@/composer/Composer';

const styles = stylex.create({
  main: {maxWidth: 880, marginInline: 'auto', padding: 16, paddingBlockEnd: 96},
  borderless: {borderColor: 'transparent', boxShadow: 'none'},
  chatFrame: {height: 560, display: 'flex', flexDirection: 'column'},
});

function State({label, children}: {label: string; children: ReactNode}) {
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">
        {label}
      </Text>
      {children}
    </VStack>
  );
}

function Fixture({value}: {value: unknown}) {
  return <CodeBlock language="json" code={JSON.stringify(value, null, 2)} maxHeight={240} xstyle={styles.borderless} />;
}

function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <VStack gap={4}>
      <Heading level={2}>{title}</Heading>
      {children}
    </VStack>
  );
}

const STREAM_WORDS = 'I found the nav in Header.tsx. Sticky positioning needs a top offset and a background so content does not show through. I am adding position sticky, top 0 and the surface token, then running typecheck again.'.split(' ');

function withStreamedText(messages: UIMessage[], words: number): UIMessage[] {
  const last = messages[messages.length - 1];
  const done = words >= STREAM_WORDS.length;
  const parts = last.parts.map(p =>
    p.type === 'text' ? {...p, text: STREAM_WORDS.slice(0, words).join(' '), state: done ? ('done' as const) : ('streaming' as const)} : p,
  );
  return [...messages.slice(0, -1), {...last, parts}];
}

function StreamingConversation() {
  const [words, setWords] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setWords(w => (w >= STREAM_WORDS.length + 10 ? 1 : w + 1)), 150);
    return () => clearInterval(id);
  }, []);
  const isStreaming = words < STREAM_WORDS.length;
  return (
    <div {...stylex.props(styles.chatFrame)}>
      <Conversation
        messages={withStreamedText(f.messages, words)}
        isStreaming={isStreaming}
        composer={<Composer placeholder="Describe a change" onSubmit={() => {}} />}
      />
    </div>
  );
}

export default function AiDevPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main {...stylex.props(styles.main)}>
      <VStack gap={10}>
        <Heading level={1}>AI components</Heading>

        <Section title="Conversation and Message">
          <State label="conversation: replays a streaming reply; scroll up to see the scroll-to-latest button">
            <StreamingConversation />
          </State>
          {f.messages.map(m => (
            <State key={m.id} label={`${m.role} ${m.id}`}>
              <Message message={m} />
            </State>
          ))}
        </Section>

        <Section title="Prompt input">
          <State label="idle, model selector">
            <Fixture value={{model: f.fixtureModel, isStreaming: false}} />
          </State>
          <State label="streaming: stop shown, input disabled">
            <Fixture value={{model: f.fixtureModel, isStreaming: true}} />
          </State>
        </Section>

        <Section title="Tool call row">
          {Object.entries(f.toolParts).map(([state, part]) => (
            <State key={state} label={part.state}>
              <Fixture value={part} />
            </State>
          ))}
        </Section>

        <Section title="Denied call">
          {f.deniedCalls.map(call => (
            <State key={call.reason} label={call.reason}>
              <Fixture value={call} />
            </State>
          ))}
        </Section>

        <Section title="Approval card">
          <State label={`pending, ${f.approvalTurnId}`}>
            <Fixture value={f.approvalCall} />
          </State>
        </Section>

        <Section title="Verify result">
          {Object.entries(f.verifyResults).map(([state, result]) => (
            <State key={state} label={state}>
              <Fixture value={result} />
            </State>
          ))}
        </Section>

        <Section title="Diff view">
          <State label={f.turnFiles.join(', ')}>
            <CodeBlock language="diff" code={f.turnDiff} maxHeight={240} xstyle={styles.borderless} />
          </State>
        </Section>

        <Section title="Checkpoint">
          <State label="marker, then restore confirm">
            <Fixture value={f.checkpoint} />
          </State>
        </Section>

        <Section title="Thinking state">
          <State label="model working">
            <Fixture value={{label: 'Thinking'}} />
          </State>
        </Section>

        <Section title="Preview toolbar">
          {f.previewStatuses.map(status => (
            <State key={status} label={status}>
              <Fixture value={{url: f.previewUrl, status}} />
            </State>
          ))}
        </Section>
      </VStack>
    </main>
  );
}

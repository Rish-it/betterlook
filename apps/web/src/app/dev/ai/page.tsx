'use client';

import type {ReactNode} from 'react';
import {notFound} from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {Heading, Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import * as f from '@/components/ai/fixtures';

const styles = stylex.create({
  main: {maxWidth: 880, marginInline: 'auto', padding: 16, paddingBlockEnd: 96},
  borderless: {borderColor: 'transparent', boxShadow: 'none'},
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

export default function AiDevPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main {...stylex.props(styles.main)}>
      <VStack gap={10}>
        <Heading level={1}>AI components</Heading>

        <Section title="Conversation and Message">
          {f.messages.map(m => (
            <State key={m.id} label={`${m.role} ${m.id}`}>
              <Fixture value={m.parts} />
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

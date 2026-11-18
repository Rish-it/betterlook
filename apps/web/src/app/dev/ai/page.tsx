'use client';

import {useEffect, useState, type ReactNode} from 'react';
import type {UIMessage} from 'ai';
import {notFound} from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {Heading, Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import * as f from '@/components/ai/fixtures';
import {Code} from '@/components/ai/Code';
import {Conversation} from '@/components/ai/Conversation';
import {Message} from '@/components/ai/Message';
import {ToolCall} from '@/components/ai/ToolCall';
import {DeniedCall} from '@/components/ai/DeniedCall';
import {ApprovalCard} from '@/components/ai/ApprovalCard';
import {VerifyResult} from '@/components/ai/VerifyResult';
import {DiffView} from '@/components/ai/DiffView';
import type {TurnEvent} from '@/lib/agent/types';
import {Composer} from '@/composer/Composer';

const styles = stylex.create({
  main: {maxWidth: 880, marginInline: 'auto', padding: 16, paddingBlockEnd: 96},
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
  return <Code language="json" code={JSON.stringify(value, null, 2)} />;
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

function ApprovalStates() {
  const [events, setEvents] = useState<TurnEvent[]>([]);
  const log = (e: TurnEvent) => setEvents(list => [...list, e]);
  return (
    <>
      <State label="pending: Approve and Deny">
        <ApprovalCard turnId={f.approvalTurnId} call={f.approvalCall} onEvent={log} />
      </State>
      <State label="pending: click Deny to see the denied state">
        <ApprovalCard turnId={f.approvalTurnId} call={{...f.approvalCall, id: 'call_pkg_2'}} onEvent={log} />
      </State>
      <State label="approved (decision: approved)">
        <ApprovalCard turnId={f.approvalTurnId} call={{...f.approvalCall, id: 'call_pkg_3', decision: 'approved'}} onEvent={log} />
      </State>
      <State label="events emitted">
        <Code language="json" code={JSON.stringify(events, null, 2)} />
      </State>
    </>
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
          <State label="idle: attach, model selector, send">
            <Composer placeholder="Describe a change" model={f.fixtureModel} onSubmit={() => {}} />
          </State>
          <State label="streaming: input, attach and model disabled; stop shown">
            <Composer placeholder="Describe a change" model={f.fixtureModel} isStreaming onStop={() => {}} onSubmit={() => {}} />
          </State>
        </Section>

        <Section title="Tool call row">
          {Object.values(f.toolParts).map(part => (
            <State key={part.toolCallId} label={part.state}>
              <ToolCall part={part} />
            </State>
          ))}
        </Section>

        <Section title="Denied call">
          {f.deniedCalls.map(call => (
            <State key={call.reason} label={call.reason}>
              <DeniedCall call={call} />
            </State>
          ))}
          <State label="for contrast: a tool error">
            <ToolCall part={f.toolParts.error} />
          </State>
        </Section>

        <Section title="Approval card">
          <ApprovalStates />
        </Section>

        <Section title="Verify result">
          {Object.entries(f.verifyResults).map(([state, result]) => (
            <State key={state} label={state}>
              <VerifyResult result={result} />
            </State>
          ))}
        </Section>

        <Section title="Diff view">
          <State label="collapsed (default)">
            <DiffView diff={f.turnDiff} />
          </State>
          <State label="expanded">
            <DiffView diff={f.turnDiff} />
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

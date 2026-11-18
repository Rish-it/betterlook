'use client';

import {useRef, useState, type SVGProps} from 'react';
import * as stylex from '@stylexjs/stylex';
import {AppShell} from '@astryxdesign/core/AppShell';
import {
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
} from '@astryxdesign/core/Chat';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {percent, pixel} from '@astryxdesign/core/Resizable/utils';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Text} from '@astryxdesign/core/Text';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {TopNav} from '@astryxdesign/core/TopNav';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Composer} from '@/composer/Composer';
import {ModelPicker} from '@/composer/ModelPicker';
import {MODELS} from '@/composer/models';

const PROJECT_NAME = 'Untitled project';
const PREVIEW_URL = '/workspace/preview';
const MOCK_REPLY = 'Got it. Edits are not connected yet, so this is a placeholder reply and nothing in your app changed.';
const NARROW = '@media (max-width: 640px)';

type Message = {id: number; sender: 'user' | 'assistant'; text: string};
type View = 'chat' | 'preview';

const styles = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  switcher: {
    display: {default: 'none', [NARROW]: 'block'},
    padding: spacingVars['--spacing-2'],
    paddingBottom: 0,
  },
  split: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
  },
  chat: (width: number) => ({
    width: {default: width, [NARROW]: '100%'},
    flexShrink: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  }),
  handle: {
    display: {default: null, [NARROW]: 'none'},
  },
  preview: {
    position: 'relative',
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    margin: spacingVars['--spacing-2'],
    marginInlineStart: {default: 0, [NARROW]: spacingVars['--spacing-2']},
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-surface'],
    overflow: 'hidden',
  },
  hiddenWhenNarrow: {
    display: {default: null, [NARROW]: 'none'},
  },
  frame: {
    flexGrow: 1,
    width: '100%',
    borderWidth: 0,
    backgroundColor: colorVars['--color-background-surface'],
  },
  loading: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'none',
  },
});

function RefreshGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function Workspace({prompt, model: initialModel}: {prompt: string; model: string}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizable = useResizable({
    defaultSize: percent(35, {min: pixel(320)}),
    minSize: 280,
    maxSize: '70%',
    containerRef,
  });
  const [model, setModel] = useState(
    MODELS.some(m => m.value === initialModel) ? initialModel : MODELS[0].value,
  );
  const [messages, setMessages] = useState<Message[]>([
    {id: 0, sender: 'user', text: prompt},
    {id: 1, sender: 'assistant', text: MOCK_REPLY},
  ]);
  const [view, setView] = useState<View>('chat');
  const [frameKey, setFrameKey] = useState(0);
  const [isFrameLoading, setIsFrameLoading] = useState(true);

  const send = (text: string, picked: string) => {
    setModel(picked);
    setMessages(list => [
      ...list,
      {id: list.length, sender: 'user', text},
      {id: list.length + 1, sender: 'assistant', text: MOCK_REPLY},
    ]);
  };

  const refresh = () => {
    setIsFrameLoading(true);
    setFrameKey(k => k + 1);
  };

  return (
    <AppShell
      height="fill"
      variant="wash"
      contentPadding={0}
      topNav={
        <TopNav
          label="Workspace"
          heading={PROJECT_NAME}
          endContent={<ModelPicker value={model} onChange={setModel} />}
        />
      }>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.switcher)}>
          <SegmentedControl label="Workspace view" layout="fill" value={view} onChange={v => setView(v as View)}>
            <SegmentedControlItem value="chat" label="Chat" />
            <SegmentedControlItem value="preview" label="Preview" />
          </SegmentedControl>
        </div>
        <div ref={containerRef} {...stylex.props(styles.split)}>
          <section
            aria-label="Chat"
            {...stylex.props(styles.chat(resizable.size), view !== 'chat' && styles.hiddenWhenNarrow)}>
            <ChatLayout composer={<Composer placeholder="Describe a change" onSubmit={send} />}>
              <ChatMessageList>
                {messages.map(m => (
                  <ChatMessage key={m.id} sender={m.sender}>
                    <ChatMessageBubble variant={m.sender === 'assistant' ? 'ghost' : 'filled'}>
                      {m.text}
                    </ChatMessageBubble>
                  </ChatMessage>
                ))}
              </ChatMessageList>
            </ChatLayout>
          </section>
          <ResizeHandle
            direction="horizontal"
            resizable={resizable}
            isAlwaysVisible={false}
            label="Resize chat and preview"
            xstyle={styles.handle}
          />
          <section
            aria-label="Preview"
            aria-busy={isFrameLoading}
            {...stylex.props(styles.preview, view !== 'preview' && styles.hiddenWhenNarrow)}>
            <Toolbar
              label="Preview"
              size="sm"
              startContent={<Text type="supporting" color="secondary">Preview</Text>}
              endContent={
                <>
                  <IconButton
                    label="Refresh preview"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={RefreshGlyph} />}
                    onClick={refresh}
                  />
                  <IconButton
                    label="Open preview in new tab"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon="externalLink" />}
                    href={PREVIEW_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                </>
              }
            />
            <iframe
              key={frameKey}
              title="App preview"
              src={PREVIEW_URL}
              sandbox="allow-scripts allow-forms allow-popups"
              onLoad={() => setIsFrameLoading(false)}
              {...stylex.props(styles.frame)}
            />
            {isFrameLoading && (
              <div {...stylex.props(styles.loading)}>
                <Spinner size="md" aria-label="Loading preview" />
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

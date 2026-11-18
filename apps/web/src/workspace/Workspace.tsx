'use client';

import {useEffect, useRef, useState, useSyncExternalStore, type SVGProps} from 'react';
import {Chat, useChat} from '@ai-sdk/react';
import {DefaultChatTransport, type UIMessage} from 'ai';
import * as stylex from '@stylexjs/stylex';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
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
import type {ProviderCredential} from '@/lib/agent/types';

const PROJECT_NAME = 'Untitled project';
const PREVIEW_URL = '/workspace/preview';
const SANDBOX_KEY = 'betterlook.sandboxId';
const CHAT_KEY = 'betterlook.chat';
const NARROW = '@media (max-width: 640px)';

const noopSubscribe = () => () => {};

// Stub until AUTH's lib/auth/client.ts lands on betterlook; replace with its import.
const getCredential = (): ProviderCredential | null => null;

type AgentMessage = UIMessage<{model: string}>;
const transport = new DefaultChatTransport<AgentMessage>({api: '/api/chat', body: () => ({credential: getCredential()})});

const readStored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

type Preview = {url: string; error?: string};

async function requestSandbox(): Promise<Preview> {
  try {
    const res = await fetch('/api/sandbox', {method: 'POST', body: JSON.stringify({sandboxId: readStored(SANDBOX_KEY)})});
    if (!res.ok) return {url: PREVIEW_URL, error: await res.text()};
    const {sandboxId, previewUrl}: {sandboxId: string; previewUrl: string} = await res.json();
    localStorage.setItem(SANDBOX_KEY, sandboxId);
    return {url: previewUrl};
  } catch {
    return {url: PREVIEW_URL, error: 'The preview sandbox could not be reached. Reload to try again.'};
  }
}

// One request per page load, so StrictMode's double effect never starts two sandboxes.
let sandboxRequest: Promise<Preview> | null = null;

const textOf = (m: UIMessage) => m.parts.map(p => (p.type === 'text' ? p.text : '')).join('');
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
  previewHiddenWhenNarrow: {
    display: {default: 'flex', [NARROW]: 'none'},
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
  const initialModelValue = MODELS.some(m => m.value === initialModel) ? initialModel : MODELS[0].value;
  const [model, setModel] = useState(initialModelValue);
  // Owned here so StrictMode's simulated unmount cannot stop the first send.
  const [chat] = useState(() => new Chat<AgentMessage>({transport}));
  const {messages, setMessages, sendMessage, status, stop, error} = useChat({chat});
  const [preview, setPreview] = useState<Preview>({url: PREVIEW_URL});
  const isBusy = status === 'submitted' || status === 'streaming';
  const [view, setView] = useState<View>('chat');
  const [frameKey, setFrameKey] = useState(0);
  const [isFrameLoading, setIsFrameLoading] = useState(true);
  // A server-rendered iframe can finish loading before hydration and its onLoad is lost.
  const isHydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const send = (text: string, sentModel: string) => {
    if (isBusy) return;
    sendMessage({text, metadata: {model: sentModel}}, {body: {model: sentModel}});
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const isNewProject = new URLSearchParams(window.location.search).has('prompt');
    const saved = isNewProject ? null : readStored(CHAT_KEY);
    if (isNewProject) {
      localStorage.removeItem(SANDBOX_KEY);
      localStorage.removeItem(CHAT_KEY);
      sandboxRequest = null;
      window.history.replaceState(null, '', `/workspace?${new URLSearchParams({model: initialModelValue})}`);
    }
    if (saved) setMessages(JSON.parse(saved));
    else sendMessage({text: prompt, metadata: {model: initialModelValue}}, {body: {model: initialModelValue}});
  }, [prompt, initialModelValue, sendMessage, setMessages]);

  useEffect(() => {
    let isCurrent = true;
    sandboxRequest ??= requestSandbox();
    sandboxRequest.then(next => {
      if (!isCurrent) return;
      setIsFrameLoading(true);
      setPreview(next);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0 && !isBusy) localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
  }, [messages, isBusy]);

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
            <ChatLayout
              composer={
                <Composer placeholder="Describe a change" onSubmit={send} model={model} onModelChange={setModel} />
              }>
              <ChatMessageList>
                {messages.map(m => (
                  <ChatMessage key={m.id} sender={m.role === 'user' ? 'user' : 'assistant'}>
                    <ChatMessageBubble
                      variant={m.role === 'user' ? 'filled' : 'ghost'}
                      metadata={
                        m.metadata?.model && (
                          <Text type="supporting" color="secondary">
                            {MODELS.find(x => x.value === m.metadata?.model)?.label}
                          </Text>
                        )
                      }>
                      {textOf(m)}
                    </ChatMessageBubble>
                  </ChatMessage>
                ))}
                {error && (
                  <ChatMessage sender="assistant">
                    <ChatMessageBubble variant="ghost">{error.message}</ChatMessageBubble>
                  </ChatMessage>
                )}
                {isBusy && (
                  <ChatMessage sender="assistant">
                    <Button label="Stop" variant="secondary" size="sm" onClick={() => stop()} />
                  </ChatMessage>
                )}
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
            {...stylex.props(styles.preview, view !== 'preview' && styles.previewHiddenWhenNarrow)}>
            <Toolbar
              label="Preview"
              size="sm"
              startContent={<Text type="supporting" color="secondary">{preview.error ?? 'Preview'}</Text>}
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
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                </>
              }
            />
            {isHydrated && (
              <iframe
                key={frameKey}
                title="App preview"
                src={preview.url}
                sandbox="allow-scripts allow-forms allow-popups"
                onLoad={() => setIsFrameLoading(false)}
                {...stylex.props(styles.frame)}
              />
            )}
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

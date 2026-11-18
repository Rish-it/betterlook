'use client';

import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useChat} from '@ai-sdk/react';
import * as stylex from '@stylexjs/stylex';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Layout';
import {
  ChatMessage,
  ChatMessageBubble,
} from '@astryxdesign/core/Chat';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {percent, pixel} from '@astryxdesign/core/Resizable/utils';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Spinner} from '@astryxdesign/core/Spinner';
import {TopNav} from '@astryxdesign/core/TopNav';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Composer} from '@/composer/Composer';
import {ModelPicker} from '@/composer/ModelPicker';
import {MODELS} from '@/lib/agent/models';
import {createAgentChat, keepTurn, keyNotice, restoreCheckpoint, retry} from '@/lib/agent/client';
import type {TurnEvent} from '@/lib/agent/types';
import {getCredential} from '@/lib/auth/client';
import {AuthControls} from '@/components/auth/AuthControls';
import {Conversation} from '@/components/ai/Conversation';
import {PreviewToolbar} from '@/components/ai/PreviewToolbar';
import {Thinking} from '@/components/ai/Thinking';
import {unshownApprovals} from '@/components/ai/turn';

const PROJECT_NAME = 'Untitled project';
const PREVIEW_URL = '/workspace/preview';
const SANDBOX_KEY = 'betterlook.sandboxId';
const APPROVAL_UNSHOWN = 'The approval could not be shown, so it was denied.';
const CHAT_KEY = 'betterlook.chat';
const NARROW = '@media (max-width: 640px)';

const noopSubscribe = () => () => {};


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

export function Workspace({prompt, model: initialModel}: {prompt: string; model: string}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizable = useResizable({
    defaultSize: percent(35, {min: pixel(320)}),
    minSize: 280,
    maxSize: '70%',
    containerRef,
  });
  const initialModelValue = MODELS.some(m => m.id === initialModel) ? initialModel : MODELS[0].id;
  const [model, setModel] = useState(initialModelValue);
  // Owned here so StrictMode's simulated unmount cannot stop the first send.
  const [chat] = useState(() => createAgentChat({getCredential, getSandboxId: () => readStored(SANDBOX_KEY)}));
  const {messages, setMessages, sendMessage, status, stop, error} = useChat({chat});
  const [preview, setPreview] = useState<Preview>({url: PREVIEW_URL});
  // The first prompt waits for the sandbox, so its request carries the sandbox id.
  const [isConnecting, setIsConnecting] = useState(false);
  const isBusy = isConnecting || status === 'submitted' || status === 'streaming';
  const [view, setView] = useState<View>('chat');
  const [frameKey, setFrameKey] = useState(0);
  const [isFrameLoading, setIsFrameLoading] = useState(true);
  // A server-rendered iframe can finish loading before hydration and its onLoad is lost.
  const isHydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // A send waits for its provider's key: the text stays in the composer and no request goes out.
  const [held, setHeld] = useState<{text: string; notice: string}>();
  const deliver = useCallback(
    async (text: string, sentModel: string) => {
      const notice = await keyNotice(sentModel, getCredential);
      setHeld(notice ? {text, notice} : undefined);
      if (!notice) void sendMessage({text, metadata: {model: sentModel}}, {body: {model: sentModel}});
    },
    [sendMessage],
  );
  const send = (text: string, sentModel: string) => {
    if (!isBusy) void deliver(text, sentModel);
  };
  const retryTurn = async () => {
    const notice = await retry(chat, getCredential);
    setHeld(notice ? {text: '', notice} : undefined);
  };

  const started = useRef(false);
  const firstSendCancelled = useRef(false);
  const stopTurn = () => {
    firstSendCancelled.current = true;
    setIsConnecting(false);
    void stop();
  };
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
    if (saved) {
      setMessages(JSON.parse(saved));
      return;
    }
    setIsConnecting(true);
    sandboxRequest ??= requestSandbox();
    // A failed sandbox still sends, so the chat shows the server's readable message.
    sandboxRequest.then(() => {
      if (firstSendCancelled.current) return;
      setIsConnecting(false);
      void deliver(prompt, initialModelValue);
    });
  }, [prompt, initialModelValue, deliver, setMessages]);

  useEffect(() => {
    let isCurrent = true;
    sandboxRequest ??= requestSandbox();
    sandboxRequest.then(next => {
      if (!isCurrent) return;
      // Same src as the frame already shows means no new onLoad, so only a new url may show the spinner.
      if (next.url !== PREVIEW_URL) setIsFrameLoading(true);
      setPreview(next);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  // An approval the designer cannot see would wait forever, so it is denied with a reason the model reads.
  const deniedApprovals = useRef(new Set<string>());
  useEffect(() => {
    for (const id of unshownApprovals(messages)) {
      if (deniedApprovals.current.has(id)) continue;
      deniedApprovals.current.add(id);
      void chat.addToolApprovalResponse({id, approved: false, reason: APPROVAL_UNSHOWN});
    }
  }, [messages, chat]);

  useEffect(() => {
    if (messages.length > 0 && !isBusy) localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
  }, [messages, isBusy]);

  const refresh = () => {
    setIsFrameLoading(true);
    setFrameKey(k => k + 1);
  };

  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const onTurnEvent = async (event: TurnEvent) => {
    const traceId = messages.find(m => m.metadata?.turnId === event.turnId)?.metadata?.traceId;
    if (event.type === 'keep') {
      await keepTurn({turnId: event.turnId, traceId});
      return;
    }
    const sandboxId = readStored(SANDBOX_KEY);
    if (event.type !== 'restore' || !sandboxId) return;
    try {
      await restoreCheckpoint({sandboxId, checkpointId: event.checkpointId, turnId: event.turnId, traceId});
      setRestoreNotice('Restored. The preview shows the app as it was at that checkpoint.');
      refresh();
    } catch (e) {
      setRestoreNotice(e instanceof Error && e.message ? e.message : 'That checkpoint could not be restored.');
    }
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
          endContent={
            <HStack gap={2} align="center">
              <ModelPicker value={model} onChange={setModel} />
              <AuthControls />
            </HStack>
          }
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
            <Conversation
              messages={messages}
              isStreaming={isBusy}
              onApproval={(id, approved) => chat.addToolApprovalResponse({id, approved})}
              onEvent={onTurnEvent}
              composer={
                <Composer
                  placeholder="Describe a change"
                  onSubmit={send}
                  model={model}
                  onModelChange={setModel}
                  isStreaming={isBusy}
                  onStop={stopTurn}
                  held={held}
                />
              }>
              {(isConnecting || status === 'submitted') && (
                <ChatMessage sender="assistant">
                  <Thinking />
                </ChatMessage>
              )}
              {restoreNotice && (
                <ChatMessage sender="assistant">
                  <ChatMessageBubble variant="ghost">{restoreNotice}</ChatMessageBubble>
                </ChatMessage>
              )}
              {/* Turn outcomes render as the message's notice; this line is only for errors that never reached a message. */}
              {error && error.message !== messages.at(-1)?.metadata?.notice && (
                <ChatMessage sender="assistant">
                  <ChatMessageBubble variant="ghost">{error.message}</ChatMessageBubble>
                  <Button label="Retry" variant="secondary" size="sm" onClick={retryTurn} />
                </ChatMessage>
              )}
            </Conversation>
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
            <PreviewToolbar
              url={preview.url}
              status={preview.error ? 'error' : isFrameLoading ? 'loading' : 'ready'}
              message={preview.error}
              onRefresh={refresh}
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

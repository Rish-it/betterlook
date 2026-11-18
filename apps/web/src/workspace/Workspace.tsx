'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {useChat} from '@ai-sdk/react';
import * as stylex from '@stylexjs/stylex';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {
  ChatMessage,
  ChatMessageBubble,
} from '@astryxdesign/core/Chat';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {percent, pixel} from '@astryxdesign/core/Resizable/utils';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Text} from '@astryxdesign/core/Text';
import {TopNav} from '@astryxdesign/core/TopNav';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Composer} from '@/composer/Composer';
import {ModelPicker} from '@/composer/ModelPicker';
import {MODELS} from '@/lib/agent/models';
import {createAgentChat, keepTurn, keyNotice, restoreCheckpoint, retry} from '@/lib/agent/client';
import type {AgentMessage, TurnEvent} from '@/lib/agent/types';
import {getCredential} from '@/lib/auth/client';
import {AuthControls} from '@/components/auth/AuthControls';
import {Conversation} from '@/components/ai/Conversation';
import {PreviewToolbar, type PreviewTab} from '@/components/ai/PreviewToolbar';
import {Thinking} from '@/components/ai/Thinking';
import {CodeView} from '@/components/ai/CodeView';
import {changedFiles, startedBuilding, unshownApprovals} from '@/components/ai/turn';
import {projectTitle, UNTITLED} from '@/components/ai/title';

const PREVIEW_URL = '/workspace/preview';
const SANDBOX_KEY = 'betterlook.sandboxId';
const APPROVAL_UNSHOWN = 'The approval could not be shown, so it was denied.';
const CHAT_KEY = 'betterlook.chat';
const TITLE_KEY = 'betterlook.title';
const NARROW = '@media (max-width: 640px)';

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
  chatOnly: {
    width: '100%',
    maxWidth: 720,
    marginInline: 'auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  chatGutter: {
    boxSizing: 'border-box',
    paddingInline: {default: spacingVars['--spacing-6'], [NARROW]: spacingVars['--spacing-3']},
  },
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
  stage: {
    position: 'relative',
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
  },
  hidden: {
    display: 'none',
  },
  settings: {
    flexGrow: 1,
    padding: spacingVars['--spacing-4'],
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
  placeholder: {
    backgroundColor: colorVars['--color-background-surface'],
  },
});

// Latched, so a retry that drops the building turn never hides the preview again.
function useHasBuilt(messages: AgentMessage[]) {
  const [hasBuilt, setHasBuilt] = useState(false);
  if (!hasBuilt && startedBuilding(messages)) setHasBuilt(true);
  return hasBuilt;
}

type PreviewPaneProps = {
  preview: Preview;
  frameKey: number;
  isLoading: boolean;
  onLoad(): void;
  onRefresh(): void;
  isHiddenWhenNarrow: boolean;
};

function PreviewPane({preview, frameKey, isLoading, onLoad, onRefresh, isHiddenWhenNarrow}: PreviewPaneProps) {
  const [hasPreview, setHasPreview] = useState(false);
  const searchParams = useSearchParams();
  // ChatGPT sign-in returns with ?chatgpt=<issue>, which the connection controls show.
  const [tab, setTab] = useState<PreviewTab>(() =>
    searchParams.has('chatgpt') ? 'settings' : 'preview',
  );
  return (
    <section
      aria-label="Preview"
      aria-busy={isLoading}
      {...stylex.props(styles.preview, isHiddenWhenNarrow && styles.previewHiddenWhenNarrow)}>
      <PreviewToolbar
        url={preview.url}
        status={preview.error ? 'error' : isLoading || !hasPreview ? 'loading' : 'ready'}
        message={preview.error}
        onRefresh={onRefresh}
        tab={tab}
        onTabChange={setTab}
      />
      <div id="preview-panel" role="tabpanel" aria-label="Preview" {...stylex.props(styles.stage, tab !== 'preview' && styles.hidden)}>
        <iframe
          key={frameKey}
          title="App preview"
          src={preview.url}
          sandbox="allow-scripts allow-forms allow-popups"
          onLoad={() => {
            onLoad();
            if (preview.url !== PREVIEW_URL) setHasPreview(true);
          }}
          {...stylex.props(styles.frame)}
        />
        {!hasPreview ? (
          <div {...stylex.props(styles.loading, styles.placeholder)}>
            <Text type="supporting" color="secondary">
              Your preview will appear here
            </Text>
          </div>
        ) : (
          isLoading && (
            <div {...stylex.props(styles.loading)}>
              <Spinner size="md" aria-label="Loading preview" />
            </div>
          )
        )}
      </div>
      {tab === 'code' && (
        <div id="code-panel" role="tabpanel" aria-label="Code" {...stylex.props(styles.stage)}>
          <CodeView sandboxId={readStored(SANDBOX_KEY)} revision={frameKey} />
        </div>
      )}
      <div id="settings-panel" role="tabpanel" aria-label="Settings" {...stylex.props(styles.settings, tab !== 'settings' && styles.hidden)}>
        <VStack gap={2} align="start">
          <Text weight="semibold">Models</Text>
          <AuthControls />
        </VStack>
      </div>
    </section>
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
  const initialModelValue = MODELS.some(m => m.id === initialModel) ? initialModel : MODELS[0].id;
  const [model, setModel] = useState(initialModelValue);
  // Owned here so StrictMode's simulated unmount cannot stop the first send.
  const [chat] = useState(() =>
    createAgentChat({
      getCredential,
      getSandboxId: () => readStored(SANDBOX_KEY),
      onFinish: ({message}) => {
        if (changedFiles(message)) refresh();
      },
    }),
  );
  const {messages, setMessages, sendMessage, status, stop, error} = useChat({chat});
  const [preview, setPreview] = useState<Preview>({url: PREVIEW_URL});
  // The first prompt waits for the sandbox, so its request carries the sandbox id.
  const [isConnecting, setIsConnecting] = useState(false);
  const isBusy = isConnecting || status === 'submitted' || status === 'streaming';
  const [title, setTitle] = useState('');
  const [view, setView] = useState<View>('chat');
  const [frameKey, setFrameKey] = useState(0);
  const [loadedFrameKey, setLoadedFrameKey] = useState<number | null>(null);
  const isFrameLoading = loadedFrameKey !== frameKey;
  const hasBuilt = useHasBuilt(messages);

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
      setTitle(readStored(TITLE_KEY) ?? UNTITLED);
      return;
    }
    const firstTitle = projectTitle(prompt);
    setTitle(firstTitle);
    localStorage.setItem(TITLE_KEY, firstTitle);
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
      if (next.url !== PREVIEW_URL) setLoadedFrameKey(null);
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

  const refresh = async () => {
    setLoadedFrameKey(null);
    const next = await (sandboxRequest = requestSandbox());
    setPreview(next);
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
          heading={title}
          endContent={
            <HStack gap={2} align="center">
              <ModelPicker value={model} onChange={setModel} />
              {!hasBuilt && <AuthControls />}
            </HStack>
          }
        />
      }>
      <div {...stylex.props(styles.body)}>
        {hasBuilt && (
          <div {...stylex.props(styles.switcher)}>
            <SegmentedControl label="Workspace view" layout="fill" value={view} onChange={v => setView(v as View)}>
              <SegmentedControlItem value="chat" label="Chat" />
              <SegmentedControlItem value="preview" label="Preview" />
            </SegmentedControl>
          </div>
        )}
        <div ref={containerRef} {...stylex.props(styles.split)}>
          <section
            aria-label="Chat"
            {...stylex.props(hasBuilt ? styles.chat(resizable.size) : styles.chatOnly, styles.chatGutter, view !== 'chat' && styles.hiddenWhenNarrow)}>
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
          {hasBuilt && (
            <>
              <ResizeHandle
                direction="horizontal"
                resizable={resizable}
                isAlwaysVisible={false}
                label="Resize chat and preview"
                xstyle={styles.handle}
              />
              <PreviewPane
                preview={preview}
                frameKey={frameKey}
                isLoading={isFrameLoading}
                onLoad={() => setLoadedFrameKey(frameKey)}
                onRefresh={refresh}
                isHiddenWhenNarrow={view !== 'preview'}
              />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

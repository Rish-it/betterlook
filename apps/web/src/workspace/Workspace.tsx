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
import {Text} from '@astryxdesign/core/Text';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {TopNav} from '@astryxdesign/core/TopNav';
import {colorVars, radiusVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';

const PROJECT_NAME = 'Untitled project';
const PREVIEW_URL = '/workspace/preview';
const MOCK_REPLY =
  'Done. I updated the hero section and checked that the app still builds and nothing else on the page moved.';

const styles = stylex.create({
  split: {
    display: 'flex',
    height: '100%',
    minHeight: 0,
  },
  chat: (width: number) => ({
    width,
    flexShrink: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  }),
  preview: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    margin: spacingVars['--spacing-2'],
    marginInlineStart: 0,
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-surface'],
    overflow: 'hidden',
  },
  frame: {
    flexGrow: 1,
    width: '100%',
    borderWidth: 0,
    backgroundColor: colorVars['--color-background-surface'],
  },
  placeholder: {
    padding: spacingVars['--spacing-3'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-surface'],
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

export function Workspace({prompt, model}: {prompt: string; model: string}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizable = useResizable({
    defaultSize: percent(35, {min: pixel(320)}),
    minSize: 280,
    maxSize: '70%',
    containerRef,
  });
  const [frameKey, setFrameKey] = useState(0);

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
            // PLACEHOLDER: FE-A ModelPicker goes here once src/composer/ModelPicker.tsx lands.
            <Text type="supporting" color="secondary">
              Model: {model || 'default'} (ModelPicker placeholder)
            </Text>
          }
        />
      }>
      <div ref={containerRef} {...stylex.props(styles.split)}>
        <section aria-label="Chat" {...stylex.props(styles.chat(resizable.size))}>
          <ChatLayout
            composer={
              // PLACEHOLDER: FE-A Composer goes here once src/composer/Composer.tsx lands.
              <div {...stylex.props(styles.placeholder)}>
                <Text color="secondary">Composer placeholder</Text>
              </div>
            }>
            <ChatMessageList>
              <ChatMessage sender="user">
                <ChatMessageBubble>{prompt}</ChatMessageBubble>
              </ChatMessage>
              <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost">{MOCK_REPLY}</ChatMessageBubble>
              </ChatMessage>
            </ChatMessageList>
          </ChatLayout>
        </section>
        <ResizeHandle
          direction="horizontal"
          resizable={resizable}
          isAlwaysVisible={false}
          label="Resize chat and preview"
        />
        <section aria-label="Preview" {...stylex.props(styles.preview)}>
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
                  onClick={() => setFrameKey(k => k + 1)}
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
            {...stylex.props(styles.frame)}
          />
        </section>
      </div>
    </AppShell>
  );
}

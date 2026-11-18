import type {SVGProps} from 'react';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack} from '@astryxdesign/core/Layout';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {Toolbar} from '@astryxdesign/core/Toolbar';

export type PreviewStatus = 'loading' | 'ready' | 'error';

const DOT = {
  loading: {variant: 'neutral', label: 'Preview loading', isPulsing: true},
  ready: {variant: 'success', label: 'Preview ready', isPulsing: false},
  error: {variant: 'error', label: 'Preview failed to load', isPulsing: false},
} as const;

function RefreshGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

type PreviewToolbarProps = {url: string; status: PreviewStatus; onRefresh(): void};

export function PreviewToolbar({url, status, onRefresh}: PreviewToolbarProps) {
  const dot = DOT[status];
  return (
    <Toolbar
      label="Preview"
      size="sm"
      startContent={
        <HStack gap={2} align="center">
          <StatusDot variant={dot.variant} label={dot.label} isPulsing={dot.isPulsing} />
          <Text type="supporting" color="secondary">
            Preview
          </Text>
        </HStack>
      }
      endContent={
        <>
          <IconButton label="Refresh preview" variant="ghost" size="sm" icon={<Icon icon={RefreshGlyph} />} onClick={onRefresh} />
          <IconButton
            label="Open preview in new tab"
            variant="ghost"
            size="sm"
            icon={<Icon icon="externalLink" />}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          />
        </>
      }
    />
  );
}

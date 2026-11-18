'use client';

import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {ChatComposer, ChatComposerDrawer, ChatComposerInput, type ChatComposerInputHandle} from '@astryxdesign/core/Chat';
import {HStack} from '@astryxdesign/core/Layout';
import {Token} from '@astryxdesign/core/Token';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '@astryxdesign/core/Icon';
import {ModelPicker} from './ModelPicker';
import {MODELS} from './models';

const styles = stylex.create({
  borderless: {
    borderColor: 'transparent',
    boxShadow: 'none',
    outlineStyle: 'none',
    backgroundColor: {
      default: 'var(--color-background-muted)',
      ':focus-within': 'color-mix(in srgb, var(--color-background-muted), var(--color-text-primary) 5%)',
    },
  },
  fileInput: {display: 'none'},
});

const fileKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;

type ComposerProps = {
  onSubmit(text: string, model: string, attachments: File[]): void;
  isStreaming?: boolean;
  onStop?(): void;
  placeholder?: string;
  autoFocus?: boolean;
  model?: string;
  onModelChange?(model: string): void;
};

export function Composer({onSubmit, isStreaming = false, onStop, placeholder, autoFocus, model: controlledModel, onModelChange}: ComposerProps) {
  const [ownModel, setOwnModel] = useState(MODELS[0].value);
  const model = controlledModel ?? ownModel;
  const pickModel = (next: string) => {
    if (controlledModel === undefined) setOwnModel(next);
    onModelChange?.(next);
  };
  const inputRef = useRef<ChatComposerInputHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);

  const submit = (text: string) => {
    onSubmit(text, model, attachments);
    setAttachments([]);
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <ChatComposer
      elevation="none"
      xstyle={styles.borderless}
      onSubmit={submit}
      isDisabled={isStreaming}
      isStopShown={isStreaming}
      onStop={onStop}
      drawer={
        attachments.length > 0 && (
          <ChatComposerDrawer label="Attachments">
            <HStack gap={2} wrap="wrap">
              {attachments.map(file => (
                <Token
                  key={fileKey(file)}
                  label={file.name}
                  isDisabled={isStreaming}
                  onRemove={() => setAttachments(list => list.filter(f => f !== file))}
                />
              ))}
            </HStack>
          </ChatComposerDrawer>
        )
      }
      input={<ChatComposerInput handleRef={inputRef} label="Message" placeholder={placeholder} />}
      footerActions={
        <>
          <input
            ref={fileRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden
            {...stylex.props(styles.fileInput)}
            onChange={e => {
              const picked = [...(e.target.files ?? [])];
              setAttachments(list => [...list, ...picked.filter(p => !list.some(f => fileKey(f) === fileKey(p)))]);
              e.target.value = '';
            }}
          />
          <IconButton
            label="Attach file"
            variant="ghost"
            icon={<Icon icon="upload" />}
            isDisabled={isStreaming}
            onClick={() => fileRef.current?.click()}
          />
          <ModelPicker value={model} onChange={pickModel} isDisabled={isStreaming} />
        </>
      }
    />
  );
}

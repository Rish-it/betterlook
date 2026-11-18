'use client';

import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {ChatComposer, ChatComposerInput, type ChatComposerInputHandle} from '@astryxdesign/core/Chat';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '@astryxdesign/core/Icon';
import {ModelPicker} from './ModelPicker';
import {MODELS} from './models';

const styles = stylex.create({
  borderless: {
    borderColor: 'transparent',
    boxShadow: 'none',
    backgroundColor: 'var(--color-background-muted)',
  },
});

type ComposerProps = {
  onSubmit(text: string, model: string): void;
  placeholder?: string;
  autoFocus?: boolean;
};

export function Composer({onSubmit, placeholder, autoFocus}: ComposerProps) {
  const [model, setModel] = useState(MODELS[0].value);
  const inputRef = useRef<ChatComposerInputHandle>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <ChatComposer
      elevation="none"
      xstyle={styles.borderless}
      onSubmit={text => onSubmit(text, model)}
      input={<ChatComposerInput handleRef={inputRef} label="Message" placeholder={placeholder} />}
      footerActions={
        <>
          <IconButton label="Attach file" variant="ghost" icon={<Icon icon="upload" />} />
          <ModelPicker value={model} onChange={setModel} />
        </>
      }
    />
  );
}

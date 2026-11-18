'use client';

import {Selector} from '@astryxdesign/core/Selector';
import {MODELS} from './models';

export function ModelPicker({value, onChange}: {value: string; onChange(model: string): void}) {
  return (
    <Selector
      label="Model"
      isLabelHidden
      variant="ghost"
      size="sm"
      options={MODELS}
      value={value}
      onChange={onChange}
    />
  );
}

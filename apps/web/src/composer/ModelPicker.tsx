'use client';

import {Selector} from '@astryxdesign/core/Selector';
import {MODELS} from './models';

type ModelPickerProps = {value: string; onChange(model: string): void; isDisabled?: boolean};

export function ModelPicker({value, onChange, isDisabled}: ModelPickerProps) {
  return (
    <Selector
      label="Model"
      isLabelHidden
      variant="ghost"
      size="sm"
      options={MODELS}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
    />
  );
}

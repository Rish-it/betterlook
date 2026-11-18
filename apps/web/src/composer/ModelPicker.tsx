'use client';

import {Selector} from '@astryxdesign/core/Selector';
import {MODELS} from '@/lib/agent/models';

const OPTIONS = MODELS.map(m => ({value: m.id, label: m.label}));

type ModelPickerProps = {value: string; onChange(model: string): void; isDisabled?: boolean};

export function ModelPicker({value, onChange, isDisabled}: ModelPickerProps) {
  return (
    <Selector
      label="Model"
      isLabelHidden
      variant="ghost"
      size="sm"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
    />
  );
}

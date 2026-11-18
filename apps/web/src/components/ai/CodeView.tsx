'use client';

import {useEffect, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Text} from '@astryxdesign/core/Text';
import {TreeList} from '@astryxdesign/core/TreeList';
import {colorVars, spacingVars} from '@astryxdesign/core/theme/tokens.stylex';
import {Code} from './Code';

const styles = stylex.create({
  root: {display: 'flex', flexGrow: 1, minWidth: 0, minHeight: 0, flexDirection: {default: 'row', '@media (max-width: 640px)': 'column'}},
  files: {
    width: {default: 200, '@media (max-width: 640px)': '100%'},
    maxHeight: {default: null, '@media (max-width: 640px)': 144},
    flexShrink: 0,
    overflow: 'auto',
    padding: spacingVars['--spacing-3'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  source: {flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: spacingVars['--spacing-3']},
  message: {display: 'grid', placeItems: 'center', flex: 1, padding: spacingVars['--spacing-6']},
});

type Source = {files: string[]; path: string; code: string};

export function CodeView({sandboxId, revision}: {sandboxId: string | null; revision: number}) {
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<{key: string; source?: Source; error?: string}>();
  const key = `${sandboxId}:${revision}:${selected}`;
  useEffect(() => {
    if (!sandboxId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({sandboxId});
    if (selected) params.set('path', selected);
    void fetch(`/api/files?${params}`, {signal: controller.signal, cache: 'no-store'})
      .then(async res => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<Source>;
      })
      .then(source => setResult({key, source}))
      .catch(error => {
        if (!controller.signal.aborted) setResult(previous => ({key, source: previous?.source, error: error instanceof Error ? error.message : 'Files could not be loaded.'}));
      });
    return () => controller.abort();
  }, [sandboxId, selected, key]);

  if (!sandboxId) return <div {...stylex.props(styles.message)}><Text color="secondary">Connect a project to browse its files.</Text></div>;
  const current = result?.key === key;
  const source = result?.source;
  const extension = source?.path.split('.').at(-1);
  const language = extension === 'tsx' || extension === 'ts' ? 'typescript' : extension === 'jsx' || extension === 'js' ? 'javascript' : extension ?? 'text';
  return (
    <div {...stylex.props(styles.root)} aria-busy={!current}>
      <nav aria-label="Project files" {...stylex.props(styles.files)}>
        <TreeList
          header={<Text type="supporting" weight="semibold">Files</Text>}
          density="compact"
          items={(source?.files ?? []).map(path => ({id: path, label: path, isSelected: path === source?.path, onClick: () => setSelected(path)}))}
        />
      </nav>
      {!current ? (
        <div {...stylex.props(styles.message)}><Spinner size="md" aria-label="Loading files" /></div>
      ) : result.error ? (
        <div role="status" {...stylex.props(styles.message)}><Text color="secondary">{result.error}</Text></div>
      ) : source?.path ? (
        <div {...stylex.props(styles.source)}>
          <Code title={source.path} code={source.code} language={language} maxHeight="none" />
        </div>
      ) : (
        <div {...stylex.props(styles.message)}><Text color="secondary">Your project files will appear here.</Text></div>
      )}
    </div>
  );
}

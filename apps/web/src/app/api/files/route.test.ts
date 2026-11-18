import {expect, spyOn, test} from 'bun:test';
import * as sandbox from '@/lib/sandbox/sandbox';
import {tempProject} from '@/lib/agent/test-project';
import {GET} from './route';

test('the code view lists source files and reads the selected file without exposing hidden or dependency files', async () => {
  const t = tempProject({'src/App.tsx': 'export default () => <h1>Hello</h1>;', 'src/index.css': 'body {margin: 0}', '.env': '', 'node_modules/pkg/index.js': ''});
  const configured = spyOn(sandbox, 'sandboxConfigured').mockReturnValue(true);
  const open = spyOn(sandbox, 'openProject').mockResolvedValue(t.project);
  try {
    const res = await GET(new Request('http://x/api/files?sandboxId=sbx-local'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({files: ['src/App.tsx', 'src/index.css'], path: 'src/App.tsx', code: t.file('src/App.tsx')});
    const selected = await GET(new Request('http://x/api/files?sandboxId=sbx-local&path=src/index.css'));
    expect((await selected.json()).code).toBe(t.file('src/index.css'));
    for (const path of ['../outside', '.env', 'node_modules/pkg/index.js']) {
      expect((await GET(new Request(`http://x/api/files?sandboxId=sbx-local&path=${encodeURIComponent(path)}`))).status).toBe(404);
    }
  } finally {
    open.mockRestore();
    configured.mockRestore();
    t.cleanup();
  }
});

test('the code view handles missing sandboxes and unavailable files', async () => {
  const configured = spyOn(sandbox, 'sandboxConfigured').mockReturnValue(true);
  const open = spyOn(sandbox, 'openProject').mockRejectedValue(new Error('unavailable'));
  try {
    expect((await GET(new Request('http://x/api/files'))).status).toBe(400);
    expect((await GET(new Request('http://x/api/files?sandboxId=sbx-local'))).status).toBe(502);
  } finally {
    open.mockRestore();
    configured.mockRestore();
  }
});

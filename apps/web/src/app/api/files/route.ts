import {isUtf8} from 'node:buffer';
import {posix} from 'node:path';
import {checkPolicy} from '@/lib/agent/policy';
import {openProject, sandboxConfigured} from '@/lib/sandbox/sandbox';

const headers = {'Cache-Control': 'no-store'};

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const sandboxId = params.get('sandboxId');
  if (!sandboxId) return new Response('Connect a project to browse its files.', {status: 400, headers});
  if (!sandboxConfigured()) return new Response('The preview sandbox is not configured yet.', {status: 503, headers});
  try {
    const project = await openProject(sandboxId);
    const files = (await project.list(project.root)).filter(path =>
      checkPolicy('read_file', {path}, project.root).type === 'allow' &&
      !path.split('/').some(part => part.startsWith('.') || part === 'node_modules' || part === 'dist'),
    ).sort();
    const path = params.get('path') ?? files.find(p => p === 'src/App.tsx') ?? files.find(p => p.startsWith('src/')) ?? files[0] ?? '';
    if (!path) return Response.json({files, path: '', code: ''}, {headers});
    if (!files.includes(path)) return new Response('That file is not available.', {status: 404, headers});
    const bytes = await project.readBytes(posix.join(project.root, path));
    if (!bytes) return new Response('That file is not available.', {status: 404, headers});
    if (bytes.byteLength > 256_000) return new Response('This file is too large to preview.', {status: 413, headers});
    if (bytes.includes(0) || !isUtf8(bytes)) return new Response('This file is not a text file.', {status: 415, headers});
    return Response.json({files, path, code: Buffer.from(bytes).toString('utf8')}, {headers});
  } catch {
    return new Response('Project files could not be loaded. Refresh to try again.', {status: 502, headers});
  }
}

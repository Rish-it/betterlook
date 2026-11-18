import {posix} from 'node:path';
import type {Sandbox} from '@vercel/sandbox';

export interface Project {
  id: string;
  root: string;
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  search(query: string, dir: string): Promise<string>;
  run(cmd: string, args: string[]): Promise<{exitCode: number; output: string}>;
}

const SKIP = ['-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*', '-not', '-path', '*/dist/*'];

export function sandboxProject(sandbox: Sandbox, root: string): Project {
  const run = async (cmd: string, args: string[]) => {
    const result = await sandbox.runCommand({cmd, args, cwd: root});
    return {exitCode: result.exitCode, output: await result.output('both')};
  };
  return {
    id: sandbox.name,
    root,
    run,
    list: async dir => (await run('find', [dir, '-type', 'f', ...SKIP])).output.split('\n').filter(Boolean).map(p => posix.relative(root, p)),
    read: async path => (await sandbox.readFileToBuffer({path}))?.toString('utf8') ?? null,
    write: (path, content) => sandbox.writeFiles([{path, content}]),
    search: async (query, dir) =>
      (await run('grep', ['-rnI', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '-e', query, dir])).output.replaceAll(`${root}/`, ''),
  };
}

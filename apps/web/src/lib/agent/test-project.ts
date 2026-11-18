import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {readUIMessageStream, simulateReadableStream, type LanguageModel, type ModelMessage} from 'ai';
import {convertArrayToReadableStream} from 'ai/test';
import type {Project} from '../sandbox/project';
import {runAgent, type AgentChunk} from './run';
import type {AgentMessage} from './types';

export type Scripted = (cmd: string, args: string[]) => {exitCode: number; output: string} | undefined;

export function tempProject(files: Record<string, string>, scripted: Scripted = () => ({exitCode: 0, output: ''})) {
  const root = mkdtempSync(join(tmpdir(), 'betterlook-test-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), content);
  }
  const sh = (cmd: string, args: string[]) => {
    try {
      return {exitCode: 0, output: execFileSync(cmd, args, {cwd: root, stdio: 'pipe'}).toString()};
    } catch (error) {
      const e = error as {status?: number; stdout?: Buffer; stderr?: Buffer};
      return {exitCode: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}`};
    }
  };
  for (const args of [['init', '-q'], ['config', 'user.name', 'T'], ['config', 'user.email', 't@t.invalid'], ['add', '-A'], ['commit', '-qm', 'starter']]) sh('git', args);
  const project: Project = {
    id: 'sbx-local',
    root,
    list: async d => sh('find', [d, '-type', 'f', '-not', '-path', '*/.git/*']).output.split('\n').filter(Boolean).map(p => relative(root, p)),
    read: async p => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    readBytes: async p => {
      try {
        return readFileSync(p);
      } catch {
        return null;
      }
    },
    write: async (p, c) => {
      mkdirSync(dirname(p), {recursive: true});
      writeFileSync(p, c);
    },
    search: async (q, d) => sh('grep', ['-rnI', '--exclude-dir=.git', '-e', q, d]).output.replaceAll(`${root}/`, ''),
    run: async (cmd, args) => (cmd === 'git' ? sh(cmd, args) : (scripted(cmd, args) ?? {exitCode: 0, output: ''})),
  };
  return {project, root, file: (p: string) => readFileSync(join(root, p), 'utf8'), cleanup: () => rmSync(root, {recursive: true, force: true})};
}

const usage = {
  inputTokens: {total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined},
  outputTokens: {total: 1, text: 1, reasoning: undefined},
};

export const toolStep = (calls: [string, string, object][]) => ({
  stream: simulateReadableStream({
    chunks: [
      ...calls.map(([toolCallId, toolName, input]) => ({type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input)})),
      {type: 'finish' as const, finishReason: {unified: 'tool-calls' as const, raw: undefined}, logprobs: undefined, usage},
    ],
  }),
});

export const textStep = (text: string) => ({
  stream: simulateReadableStream({
    chunks: [
      {type: 'text-start' as const, id: 't'},
      {type: 'text-delta' as const, id: 't', delta: text},
      {type: 'text-end' as const, id: 't'},
      {type: 'finish' as const, finishReason: {unified: 'stop' as const, raw: undefined}, logprobs: undefined, usage},
    ],
  }),
});

export async function runTurn(options: {model: Exclude<LanguageModel, string>; messages: ModelMessage[]; project?: Project; abortSignal?: AbortSignal; keepSandbox?: boolean}) {
  const {stream, turn} = runAgent(options);
  const chunks: AgentChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  let message: AgentMessage | undefined;
  for await (const m of readUIMessageStream<AgentMessage>({stream: convertArrayToReadableStream(chunks)})) message = m;
  return {chunks, message: message!, record: await turn};
}

import {posix} from 'node:path';
import {jsonSchema, tool, type ToolSet} from 'ai';
import type {Project} from '../sandbox/project';
import {AGENT_CONFIG} from './config';
import {checkPolicy} from './policy';
import type {ToolCallRecord, ToolName} from './types';

const pathProp = {type: 'string', description: 'Path relative to the project root.'};

export const TOOL_DEFINITIONS = {
  list_files: {
    description: 'List project files under a folder, skipping node_modules, .git and dist.',
    schema: {type: 'object', properties: {path: {...pathProp, default: '.'}}, additionalProperties: false},
  },
  read_file: {
    description: 'Read a text file.',
    schema: {type: 'object', properties: {path: pathProp}, required: ['path'], additionalProperties: false},
  },
  search: {
    description: 'Search file contents for a regular expression. Returns matching lines as path:line:text.',
    schema: {
      type: 'object',
      properties: {query: {type: 'string'}, path: {...pathProp, default: '.'}},
      required: ['query'],
      additionalProperties: false,
    },
  },
  edit_file: {
    description: 'Replace one exact, unique occurrence of oldString with newString in a file. Include enough surrounding text to make oldString unique.',
    schema: {
      type: 'object',
      properties: {path: pathProp, oldString: {type: 'string'}, newString: {type: 'string'}},
      required: ['path', 'oldString', 'newString'],
      additionalProperties: false,
    },
  },
  write_file: {
    description: 'Create a file or replace its whole content.',
    schema: {
      type: 'object',
      properties: {path: pathProp, content: {type: 'string'}},
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  typecheck: {
    description: 'Run the project typecheck (tsc --noEmit) and return its output.',
    schema: {type: 'object', properties: {}, additionalProperties: false},
  },
} satisfies Record<ToolName, {description: string; schema: object}>;

type Input = {path?: string; query?: string; oldString?: string; newString?: string; content?: string};

const clip = (text: string) =>
  text.length > AGENT_CONFIG.maxToolOutputChars ? `${text.slice(0, AGENT_CONFIG.maxToolOutputChars)}\n[truncated]` : text;

export const countOf = (text: string, part: string) => (part ? text.split(part).length - 1 : 0);

export function proposedDiff(path: string, before: string | null, after: string) {
  const lines = (text: string, sign: string) => (text ? text.split('\n').map(l => `${sign}${l}`) : []);
  return [`--- a/${path}`, `+++ b/${path}`, ...lines(before ?? '', '-'), ...lines(after, '+')].join('\n');
}

export function applyEdit(content: string, oldString: string, newString: string): string {
  const matches = countOf(content, oldString);
  if (matches === 0) throw new Error('oldString was not found. Read the file and copy the exact text.');
  if (matches > 1) throw new Error(`oldString matches ${matches} places. Include more surrounding text.`);
  return content.replace(oldString, () => newString);
}

async function execute(project: Project, name: ToolName, input: Input, rel: string) {
  const abs = posix.join(project.root, rel);
  switch (name) {
    case 'list_files':
      return clip((await project.list(abs)).sort().join('\n'));
    case 'read_file': {
      const content = await project.read(abs);
      if (content === null) throw new Error(`${rel} does not exist.`);
      return clip(content);
    }
    case 'search':
      return clip(await project.search(input.query ?? '', abs)) || 'No matches.';
    case 'edit_file': {
      const content = await project.read(abs);
      if (content === null) throw new Error(`${rel} does not exist.`);
      await project.write(abs, applyEdit(content, input.oldString ?? '', input.newString ?? ''));
      return `Edited ${rel}.`;
    }
    case 'write_file':
      await project.write(abs, input.content ?? '');
      return `Wrote ${rel}.`;
    case 'typecheck': {
      const {exitCode, output} = await project.run('npm', ['run', '--silent', 'typecheck']);
      return {ok: exitCode === 0, output: clip(output.trim()) || 'No type errors.'};
    }
  }
}

export function createTools(project: Project, toolCalls: ToolCallRecord[]): ToolSet {
  let writes = Promise.resolve();
  const writeTurn = async (name: ToolName) => {
    let release = () => {};
    if (name !== 'write_file' && name !== 'edit_file') return release;
    const previous = writes;
    writes = new Promise(resolve => (release = resolve));
    await previous;
    return release;
  };
  const entries = AGENT_CONFIG.tools.map(name => [
    name,
    tool({
      description: TOOL_DEFINITIONS[name].description,
      inputSchema: jsonSchema<Input>(TOOL_DEFINITIONS[name].schema),
      execute: async (input, {toolCallId}) => {
        const decision = checkPolicy(name, input, project.root);
        if (decision.type === 'deny') throw new Error(decision.message);
        const release = await writeTurn(name);
        const startedAt = new Date();
        const record: ToolCallRecord = {
          id: toolCallId,
          tool: name,
          args: input,
          result: null,
          decision: decision.type === 'approve' ? 'approved' : 'allowed',
          startedAt: startedAt.toISOString(),
          durationMs: 0,
        };
        toolCalls.push(record);
        try {
          record.result = await execute(project, name, input, decision.path ?? '.');
          return record.result;
        } catch (error) {
          record.result = {error: error instanceof Error ? error.message : String(error)};
          throw error;
        } finally {
          record.durationMs = Date.now() - startedAt.getTime();
          release();
        }
      },
    }),
  ]);
  return Object.fromEntries(entries);
}

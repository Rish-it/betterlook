import type {ToolName} from './types';

export const AGENT_CONFIG = {
  maxSteps: 20,
  maxOutputTokens: 8_000,
  tools: ['list_files', 'read_file', 'search', 'edit_file', 'write_file', 'typecheck'] satisfies ToolName[],
  deniedPaths: ['.git', 'node_modules'],
  approvalFiles: ['package.json', 'package-lock.json', '*.lock', 'pnpm-lock.yaml', 'tsconfig*.json', '*.config.*', '.env*'],
  maxToolOutputChars: 20_000,
  promptCachePerProject: true,
} as const;

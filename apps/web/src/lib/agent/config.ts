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

export const RUNNER_CONFIG = {
  concurrency: 2,
  maxAttempts: 3,
  backoffMs: 5_000,
} as const;

export const SANDBOX_CONFIG = {
  vcpus: 2,
  timeoutMs: 10 * 60_000,
  snapshotExpirationMs: 7 * 24 * 60 * 60_000,
} as const;

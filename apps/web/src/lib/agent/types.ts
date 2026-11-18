export type ProviderId = 'openai' | 'anthropic';

export type ProviderCredential =
  | {provider: ProviderId; kind: 'api-key'; apiKey: string}
  | {provider: ProviderId; kind: 'oauth'; accessToken: string; expiresAt?: number};

export type ToolName = 'list_files' | 'read_file' | 'search' | 'edit_file' | 'write_file' | 'typecheck';

export interface DeniedCall {
  tool: string;
  args: unknown;
  reason: 'outside-project' | 'not-allowlisted' | 'user-denied';
  message: string;
  at: string;
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  args: unknown;
  result: unknown;
  decision: 'allowed' | 'denied' | 'approved';
  denied?: DeniedCall;
  startedAt: string;
  durationMs: number;
}

export interface VerifyCheck {
  name: 'typecheck' | 'build' | 'runtime';
  ok: boolean;
  errors: string[];
  durationMs: number;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
}

export interface Checkpoint {
  id: string;
  sandboxId: string;
  turnId: string;
  createdAt: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
}

export type TurnStatus = 'running' | 'awaiting-approval' | 'passed' | 'failed' | 'stopped' | 'error';

export interface TurnRecord {
  id: string;
  traceId: string;
  sandboxId: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  systemPromptHash: string;
  toolConfigHash: string;
  toolCalls: ToolCallRecord[];
  usage: Usage;
  diff: string;
  filesTouched: string[];
  verify: VerifyResult | null;
  repairAttempted: boolean;
  repairVerify: VerifyResult | null;
  status: TurnStatus;
  error?: string;
  checkpoint: Checkpoint | null;
  startedAt: string;
  endedAt: string | null;
}

export type TurnEvent =
  | {type: 'restore'; turnId: string; checkpointId: string; at: string}
  | {type: 'keep'; turnId: string; at: string}
  | {type: 'approve'; turnId: string; toolCallId: string; at: string}
  | {type: 'deny'; turnId: string; toolCallId: string; at: string};

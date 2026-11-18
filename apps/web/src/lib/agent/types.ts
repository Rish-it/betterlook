import type {FinishReason, UIMessage} from 'ai';

export type ProviderId = 'openai' | 'anthropic';

export type ProviderCredential =
  | {provider: ProviderId; kind: 'api-key'; apiKey: string}
  | {provider: ProviderId; kind: 'oauth'; accessToken: string; expiresAt?: number};

export type ToolName = 'list_files' | 'read_file' | 'search' | 'edit_file' | 'write_file' | 'typecheck';

export interface DeniedCall {
  toolCallId: string;
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
  decision: 'allowed' | 'denied' | 'approved' | 'cancelled';
  denied?: DeniedCall;
  startedAt: string;
  durationMs: number;
}

export type VerifyCheckStatus = 'passed' | 'failed' | 'skipped';

export interface VerifyCheck {
  name: 'typecheck' | 'build' | 'runtime';
  status: VerifyCheckStatus;
  errors: string[];
  durationMs: number;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
}

export interface Checkpoint {
  id: string;
  parentId: string;
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

export interface SandboxUsage {
  vcpus: number;
  activeCpuMs: number | null;
  durationMs: number | null;
}

export type TurnStatus = 'running' | 'awaiting-approval' | 'passed' | 'no-changes' | 'unverified' | 'failed' | 'stopped' | 'error';

export interface TurnRecord {
  id: string;
  traceId: string;
  sandboxId: string;
  prompt: string;
  provider: string;
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
  steps: {finishReason: FinishReason; outputTokens: number}[];
  lengthStops: number;
  stepLimitReached: boolean;
  status: TurnStatus;
  error?: string;
  checkpoint: Checkpoint | null;
  sandbox: SandboxUsage | null;
  startedAt: string;
  endedAt: string | null;
}

export type TurnEvent =
  | {type: 'restore'; turnId: string; traceId?: string; checkpointId: string; at: string}
  | {type: 'keep'; turnId: string; traceId?: string; at: string}
  | {type: 'approve'; turnId: string; traceId?: string; toolCallId: string; at: string}
  | {type: 'deny'; turnId: string; traceId?: string; toolCallId: string; at: string};

export interface PendingApproval {
  toolCallId: string;
  tool: ToolName;
  path: string;
  diff: string;
}

export interface TurnDiff {
  diff: string;
  filesTouched: string[];
}

export type AgentDataParts = {
  denied: DeniedCall;
  approval: PendingApproval;
  verify: VerifyResult;
  checkpoint: Checkpoint;
  diff: TurnDiff;
};

export interface AgentMetadata {
  model?: string;
  turnId?: string;
  traceId?: string;
  status?: TurnStatus;
  notice?: string;
}

export type AgentMessage = UIMessage<AgentMetadata, AgentDataParts>;

// Founder-owned: write the system prompt here. Empty means no instructions are sent.
export const SYSTEM_PROMPT = '';

// Founder-owned: the message the agent gets for its one repair attempt. {errors} is replaced with the failing checks.
export const REPAIR_PROMPT = 'Verify failed after your change. Fix these errors:\n\n{errors}';

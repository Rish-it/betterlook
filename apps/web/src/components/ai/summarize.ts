const KEYS = ['path', 'command', 'query', 'pattern'];

export function summarizeArgs(args: unknown, max = 60): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  const key = KEYS.find(k => typeof record[k] === 'string') ?? Object.keys(record).find(k => typeof record[k] === 'string');
  const value = key && (record[key] as string);
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

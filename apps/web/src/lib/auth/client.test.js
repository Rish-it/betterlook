import {expect, test} from 'bun:test';
import {randomBytes} from 'node:crypto';
import {getCredential, setApiKey} from './client';

test('browser API keys are trimmed and isolated by provider', () => {
  const openaiKey = randomBytes(32).toString('base64url');
  const anthropicKey = randomBytes(32).toString('base64url');

  try {
    setApiKey('openai', `  ${openaiKey}  `);
    expect(getCredential('anthropic') === null).toBe(true);
    setApiKey('anthropic', `  ${anthropicKey}  `);

    const openai = getCredential('openai');
    expect(openai?.provider).toBe('openai');
    expect(openai?.kind).toBe('api-key');
    expect(openai?.apiKey === openaiKey).toBe(true);

    const anthropic = getCredential('anthropic');
    expect(anthropic?.provider).toBe('anthropic');
    expect(anthropic?.kind).toBe('api-key');
    expect(anthropic?.apiKey === anthropicKey).toBe(true);

    setApiKey('openai', '  ');
    expect(getCredential('openai') === null).toBe(true);
    expect(getCredential('anthropic')?.apiKey === anthropicKey).toBe(true);
  } finally {
    setApiKey('openai', '');
    setApiKey('anthropic', '');
  }
});

import {expect, test} from 'bun:test';
import {randomBytes} from 'node:crypto';
import {getCredential, setOpenAIApiKey} from './client';

test('browser credential contains only the current in-memory API key', () => {
  const key = randomBytes(32).toString('base64url');
  expect(getCredential()).toBeNull();
  setOpenAIApiKey(`  ${key}  `);
  const credential = getCredential();
  expect(credential.provider).toBe('openai');
  expect(credential.kind).toBe('api-key');
  expect(credential.apiKey === key).toBe(true);
  setOpenAIApiKey('');
  expect(getCredential()).toBeNull();
});

import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {setTimeout} from 'node:timers';
import type {Authorization, OpenAISession} from './openai';

const transactionLifetime = 10 * 60 * 1000;
const sessionLifetime = 8 * 60 * 60 * 1000;

export type StoredSession = OpenAISession & {
  refresh?: Promise<void>;
  retryAfter?: number;
  expiresAt: number;
  closed?: boolean;
};

function expiringRecords<Value>(now: () => number) {
  const records = new Map<string, {
    value: Value;
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function remove(id: string) {
    const entry = records.get(id);
    if (!entry) return;
    records.delete(id);
    clearTimeout(entry.timer);
    if (entry.expiresAt > now()) return entry.value;
  }

  return {
    add(id: string, value: Value, expiresAt: number) {
      const timer = setTimeout(() => records.delete(id), expiresAt - now());
      timer.unref();
      records.set(id, {value, expiresAt, timer});
    },
    get(id: string) {
      const entry = records.get(id);
      if (entry && entry.expiresAt > now()) return entry.value;
    },
    remove,
  };
}

export function createSessionStorage(key: Buffer, secure: boolean, now: () => number) {
  const prefix = secure ? '__Host-' : '';
  const transactionCookie = `${prefix}betterlook-oauth`;
  const sessionCookie = `${prefix}betterlook-chatgpt`;
  const attributes = `; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  const transactions = expiringRecords<Authorization>(now);
  const sessions = expiringRecords<StoredSession>(now);

  function cookie(name: string, id: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(name));
    const encrypted = Buffer.concat([cipher.update(id), cipher.final()]);
    const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    return `${name}=${value}${attributes}`;
  }

  function read(request: Request, name: string) {
    const value = request.headers.get('cookie')?.split(';')
      .map(part => part.trim()).find(part => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    if (!value || !/^[A-Za-z0-9_-]{80}$/.test(value)) return null;
    try {
      const bytes = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(name));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('base64url');
    } catch {
      return null;
    }
  }

  return {
    start(request: Request, transaction: Authorization) {
      const previous = read(request, transactionCookie);
      if (previous) transactions.remove(previous);
      const id = randomBytes(32);
      transactions.add(id.toString('base64url'), transaction, now() + transactionLifetime);
      return cookie(transactionCookie, id);
    },
    consume(request: Request) {
      const id = read(request, transactionCookie);
      return id ? transactions.remove(id) : undefined;
    },
    clearTransaction: `${transactionCookie}=${attributes}; Max-Age=0`,

    connect(session: OpenAISession) {
      const id = randomBytes(32);
      const expiresAt = now() + sessionLifetime;
      sessions.add(id.toString('base64url'), {...session, expiresAt}, expiresAt);
      return cookie(sessionCookie, id);
    },
    session(request: Request) {
      const id = read(request, sessionCookie);
      return {session: id ? sessions.get(id) : undefined, hadSession: Boolean(id)};
    },
    disconnect(request: Request) {
      const id = read(request, sessionCookie);
      const session = id ? sessions.remove(id) : undefined;
      if (session) session.closed = true;
      return session;
    },
    clearSession: `${sessionCookie}=${attributes}; Max-Age=0`,
  };
}

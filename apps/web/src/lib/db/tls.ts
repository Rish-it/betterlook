import {resolve} from 'node:path';

export function verifiedDatabaseUrl(name: 'DATABASE_URL' | 'DIRECT_URL') {
  const connectionString = process.env[name];
  if (!connectionString) return;

  const url = URL.parse(connectionString);
  if (!url) throw new Error(`${name} must be a valid URL.`);

  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', resolve('supabase-ca.crt'));
  return url.href;
}

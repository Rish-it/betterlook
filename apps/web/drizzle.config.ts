import {defineConfig} from 'drizzle-kit';
import {verifiedDatabaseUrl} from './src/lib/db/tls';

const url = verifiedDatabaseUrl('DIRECT_URL');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema.ts',
  out: '../../supabase/migrations',
  schemaFilter: ['public'],
  entities: {roles: {provider: 'supabase'}},
  dbCredentials: url ? {url} : undefined,
});

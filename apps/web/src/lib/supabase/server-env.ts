import 'server-only';

export function getSupabaseSecretKey() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY is required.');
  return key;
}

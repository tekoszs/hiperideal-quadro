import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

/** True quando as duas variáveis de ambiente do Supabase estão preenchidas. */
export function isSupabaseConfigured(): boolean {
  return url.length > 0 && anonKey.length > 0;
}

let client: SupabaseClient | null = null;

/** Cliente Supabase singleton. Retorna null enquanto o .env não estiver configurado. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

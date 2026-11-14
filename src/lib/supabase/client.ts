import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase público (browser/anon key).
 * Chaves secret/service_role NUNCA entram no bundle do frontend.
 */
export function getSupabaseBrowserConfig() {
  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  // Chave pública: aceita a "publishable key" (novo formato) ou a "anon key" (legado).
  const anonKey =
    (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
    (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined);
  const isConfigured = Boolean(
    url &&
      anonKey &&
      !url.includes('seu-projeto.supabase.co') &&
      !anonKey.includes('sua-chave')
  );
  return { url, anonKey, isConfigured };
}

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseBrowserConfig();
  if (!isConfigured || !url || !anonKey) return null;
  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return browserClient;
}

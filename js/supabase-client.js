import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm'

// ВАЖНО: Прямой URL Supabase, не Layero!
const SUPABASE_URL = 'https://rrpcqrvkhmlrdqvffnax.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1Fh3LgYtH3wEkQjvBfiZsA_WZZsfsLF';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    experimental: { recoveryCodes: true }
  }
});
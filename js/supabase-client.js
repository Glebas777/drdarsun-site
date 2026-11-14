import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm'

// Твой URL Layero (через который идут запросы)
const SUPABASE_URL = 'https://drdarsun-site-main.layero.app';
const SUPABASE_ANON_KEY = 'sb_publishable_1Fh3LgYtH3wEkQjvBfiZsA_WZZsfsLF';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Эта строчка отключает баг с блокировкой в браузере
    lock: (name, acquireTimeout, fn) => fn() 
  }
});
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm'

// ТЕПЕРЬ СТУЧИМСЯ НА ТВОЙ ДОМЕН, А НЕ НА WORKERS.DEV
const SUPABASE_URL = 'https://supabase.drdarsun.ru/auth/v1/callback';

// Твой ANON KEY (публичный, из .env)
const SUPABASE_ANON_KEY = 'sb_publishable_1Fh3LgYtH3wEkQjvBfiZsA_WZZsfsLF'; 

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        // Отключаем проблемную блокировку Navigator LockManager
        lock: async (name, acquireTimeout, fn) => {
            return await fn();
        }
    }
});
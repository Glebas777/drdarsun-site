import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm'

// Используем Layero как главный прокси для телефонов
const SUPABASE_URL = 'https://drdarsun-site-main.layero.app';
const SUPABASE_ANON_KEY = 'sb_publishable_1Fh3LgYtH3wEkQjvBfiZsA_WZZsfsLF';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        lock: async (name, acquireTimeout, fn) => await fn() // Отключаем баг с блокировкой
    }
});
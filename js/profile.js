import { supabase } from './supabase-client.js';

async function init() {
    // 1. Пытаемся получить сессию из URL (если вернулись с OAuth)
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (session) {
        // Сессия есть — загружаем профиль
        loadProfile(session);
    } else {
        // 2. Если сессии нет, проверяем, есть ли токен в URL
        const hash = window.location.hash;
        if (hash && hash.includes('access_token')) {
            // Ждем, пока Supabase обработает токен
            setTimeout(async () => {
                const { data: { session: retrySession } } = await supabase.auth.getSession();
                if (retrySession) {
                    loadProfile(retrySession);
                } else {
                    window.location.href = 'login.html';
                }
            }, 1500);
        } else {
            // Токена нет — отправляем на вход
            window.location.href = 'login.html';
        }
    }
}

async function loadProfile(session) {
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // Кошелек
    try {
        const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).single();
        document.getElementById('wallet-balance').textContent = w ? `${w.balance} ₽` : '0 ₽';
    } catch (e) {
        console.log('Ошибка загрузки кошелька:', e);
    }

    // SOS
    document.getElementById('sos-btn')?.addEventListener('click', async () => {
        if (!confirm('Выкинуть вас со всех устройств?')) return;
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
}

// Запускаем
init();
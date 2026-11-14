import { supabase } from './supabase-client.js';

async function init() {
    // Слушаем изменения состояния авторизации
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (session) {
                // Сессия появилась! Загружаем профиль
                loadProfile(session);
            } else {
                // Сессии нет — отправляем на вход
                window.location.href = 'login.html';
            }
        }
    });
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
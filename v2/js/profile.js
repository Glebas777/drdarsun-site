import { supabase } from './supabase-client.js';

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = 'login.html';

    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // Кошелек
    const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).single();
    document.getElementById('wallet-balance').textContent = w ? `${w.balance} ₽` : '0 ₽';

    // SOS
    document.getElementById('sos-btn')?.addEventListener('click', async () => {
        if (!confirm('Выкинуть вас со всех устройств?')) return;
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
}
init();
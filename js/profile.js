import { supabase } from './supabase-client.js';

async function initProfile() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('profile-grid').style.display = 'grid';

    const user = session.user;
    document.getElementById('user-name').textContent = user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = user.email || 'Не привязан';

    const { data: tgLink } = await supabase.from('telegram_links').select('*').eq('user_id', user.id).eq('is_verified', true).single();

    if (!tgLink) {
        document.getElementById('tg-link-block').style.display = 'block';
    }

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });

    document.getElementById('link-tg-btn')?.addEventListener('click', async () => {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        await supabase.from('telegram_links').upsert({ user_id: user.id, link_code: code, is_verified: false });
        showToast(`Код: ${code}. Перейдите в @darsun_code_bot`, 'info');
        window.open(`https://t.me/darsun_code_bot?start=${code}`, '_blank');
    });
}

initProfile();
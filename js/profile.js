import { supabase } from './supabase-client.js';

async function init() {
    await new Promise(resolve => setTimeout(resolve, 300));
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = 'login.html';

    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;
    document.getElementById('settings-name').value = session.user.user_metadata.full_name || '';

    // Кошелек
    try {
        const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).single();
        document.getElementById('wallet-balance').textContent = w ? `${w.balance} ₽` : '0 ₽';
    } catch (e) { console.log('Кошелек не найден'); }

    // Заказы
    const { data: orders } = await supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
    const ordersList = document.getElementById('orders-list');
    if (!orders || orders.length === 0) {
        ordersList.innerHTML = '<p style="color: var(--text-muted);">У вас пока нет заказов.</p>';
    } else {
        ordersList.innerHTML = orders.map(o => `<div style="background: var(--bg-color); padding: 15px; border-radius: 8px; margin-bottom: 10px; border: 1px solid var(--border);"><p><strong>Заказ #${o.id.slice(0,8)}</strong></p><p>Сумма: ${o.total} ₽</p></div>`).join('');
    }

    // Настройки: Имя
    document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = document.getElementById('settings-name').value;
        const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
        if (error) alert('Ошибка: ' + error.message);
        else { alert('Имя обновлено!'); document.getElementById('user-name').textContent = newName; }
    });

    // Настройки: Пароль
    document.getElementById('password-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPass = document.getElementById('new-password').value;
        if (newPass.length < 6) return alert('Пароль слишком короткий');
        const { error } = await supabase.auth.updateUser({ password: newPass });
        if (error) alert('Ошибка: ' + error.message);
        else alert('Пароль изменен!');
    });

// Сессии
const sessionMenuBtn = document.getElementById('session-menu-btn');
const sessionMenu = document.getElementById('session-menu');

if (sessionMenuBtn && sessionMenu) {
    sessionMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sessionMenu.style.display = sessionMenu.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', (e) => {
        if (!sessionMenu.contains(e.target) && !sessionMenuBtn.contains(e.target)) {
            sessionMenu.style.display = 'none';
        }
    });

    // 1. Выйти с этого устройства (мгновенно)
    document.getElementById('logout-current')?.addEventListener('click', async () => {
        await supabase.auth.signOut({ scope: 'local' });
        window.location.reload(); // <--- ОБНОВЛЕНИЕ
    });

    // 2. Выйти на всех, кроме этого (пока так: выходим везде и обновляем)
    document.getElementById('logout-others')?.addEventListener('click', async () => {
        if (!confirm('Вы уверены? Все остальные устройства будут отключены.')) return;
        await supabase.auth.signOut({ scope: 'global' });
        window.location.reload(); // <--- ОБНОВЛЕНИЕ
    });

    // 3. Выйти везде
    document.getElementById('logout-all')?.addEventListener('click', async () => {
        if (!confirm('Вы уверены? Вы выйдете со всех устройств.')) return;
        await supabase.auth.signOut({ scope: 'global' });
        window.location.href = 'login.html'; // <--- ПЕРЕХОД НА ВХОД
    });
}

    // Вкладки
    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}
init();
import { supabase } from './supabase-client.js';

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // 1. Данные
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // 2. Кошелек
    const walletEl = document.getElementById('wallet-balance');
    if (walletEl) {
        const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).single();
        walletEl.textContent = w ? `${w.balance} ₽` : '0 ₽';
    }

    // 3. Заказы
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        const { data: orders } = await supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!orders || orders.length === 0) {
            ordersList.innerHTML = '<div class="empty-state">У вас пока нет заказов.</div>';
        } else {
            ordersList.innerHTML = orders.map(o => `
                <div class="order-card" style="border:1px solid var(--border); padding:15px; border-radius:12px; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;"><strong>Заказ #${o.id.split('-')[0]}</strong><span>${o.status}</span></div>
                    <div style="font-size:14px; color:var(--text-muted);">Итого: ${o.total} ₽</div>
                </div>
            `).join('');
        }
    }

    // 4. Вкладки
    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId)?.classList.add('active');
        });
    });

    // 5. Меню устройств (троеточие)
    const sessionBtn = document.getElementById('session-menu-btn');
    const sessionMenu = document.getElementById('session-menu');
    if (sessionBtn && sessionMenu) {
        sessionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sessionMenu.style.display = sessionMenu.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => {
            if (!sessionBtn.contains(e.target) && !sessionMenu.contains(e.target)) {
                sessionMenu.style.display = 'none';
            }
        });
    }

    // 6. ВЫХОДЫ (Жестко и без соплей)
    document.getElementById('logout-all')?.addEventListener('click', async () => {
        if (!confirm('Выйти со всех устройств?')) return;
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });

    document.getElementById('logout-current')?.addEventListener('click', async () => {
        if (!confirm('Выйти с этого устройства?')) return;
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });

document.getElementById('logout-others')?.addEventListener('click', async () => {
    if (!confirm('Выйти на всех, кроме этого?')) return;
    const { data: { session } } = await supabase.auth.getSession();
    
    try {
        await fetch('https://drdarsun-site-main.layero.app/api/logout-others', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        alert('Другие сессии закрыты!');
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
});

    // 7. Смена имени
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        document.getElementById('settings-name').value = session.user.user_metadata.full_name || '';
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = document.getElementById('settings-name').value;
            const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
            if (error) alert('Ошибка: ' + error.message);
            else {
                alert('Имя обновлено!');
                document.getElementById('user-name').textContent = newName;
            }
        });
    }

    // 8. Смена пароля
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('new-password').value;
            if (newPassword.length < 6) return alert('Пароль слишком короткий');
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) alert('Ошибка: ' + error.message);
            else {
                alert('Пароль изменен!');
                passwordForm.reset();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', init);
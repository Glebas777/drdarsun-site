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
    
    // Кнопки выхода
    document.getElementById('logout-all')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });
}
init();
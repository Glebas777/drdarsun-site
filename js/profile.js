import { supabase } from './supabase-client.js';

async function init() {
    // Ждем полсекунды, чтобы Supabase успел прочитать сессию
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const { data: { session } } = await supabase.auth.getSession();
    
    // Если не вошел — на страницу входа
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // 1. Заполняем данные пользователя
    const name = session.user.user_metadata.full_name || 'Гость';
    const email = session.user.email;
    
    const nameEl = document.getElementById('user-name');
    const emailEl = document.getElementById('user-email');
    const settingsNameEl = document.getElementById('settings-name');

    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = email;
    if (settingsNameEl) settingsNameEl.value = name;

    // 2. Загрузка заказов (заглушка, пока таблица пустая)
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        const { data: orders } = await supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!orders || orders.length === 0) {
            ordersList.innerHTML = '<p style="color: var(--text-muted);">У вас пока нет заказов.</p>';
        } else {
            ordersList.innerHTML = orders.map(order => `
                <div style="background: var(--bg-color); padding: 15px; border-radius: 8px; margin-bottom: 10px; border: 1px solid var(--border);">
                    <p><strong>Заказ #${order.id.slice(0, 8)}</strong> от ${new Date(order.created_at).toLocaleDateString()}</p>
                    <p>Сумма: ${order.total} ₽</p>
                </div>
            `).join('');
        }
    }

    // 3. Загрузка кошелька
    const walletBalance = document.getElementById('wallet-balance');
    if (walletBalance) {
        try {
            const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).single();
            walletBalance.textContent = w ? `${w.balance} ₽` : '0 ₽';
        } catch (e) {
            walletBalance.textContent = '0 ₽';
        }
    }

    // 4. Сохранение имени
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = document.getElementById('settings-name').value;
            const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
            
            if (error) {
                alert('Ошибка: ' + error.message);
            } else {
                alert('Имя обновлено!');
                if (nameEl) nameEl.textContent = newName;
            }
        });
    }

    // 5. Смена пароля
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPass = document.getElementById('new-password').value;
            
            if (newPass.length < 6) {
                return alert('Пароль слишком короткий (минимум 6 символов)');
            }

            const { error } = await supabase.auth.updateUser({ password: newPass });
            
            if (error) {
                alert('Ошибка: ' + error.message);
            } else {
                alert('Пароль успешно изменен!');
                document.getElementById('new-password').value = '';
            }
        });
    }

    // 6. SOS (Выйти со всех устройств)
    const sosBtn = document.getElementById('sos-btn');
    if (sosBtn) {
        sosBtn.addEventListener('click', async () => {
            if (!confirm('Вы уверены? Это выкинет вас со всех устройств.')) return;
            
            // Выход со всех устройств (scope: global)
            const { error } = await supabase.auth.signOut({ scope: 'global' });
            
            if (error) {
                alert('Ошибка: ' + error.message);
            } else {
                window.location.href = 'login.html';
            }
        });
    }

    // 7. Кнопки вкладок (Настройки, Заказы, Кошелек)
    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Убираем активный класс со всех кнопок и вкладок
            document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            
            // Добавляем активный класс текущей
            btn.classList.add('active');
            const tabId = 'tab-' + btn.dataset.tab;
            const tab = document.getElementById(tabId);
            if (tab) tab.classList.add('active');
        });
    });
}

// Запускаем
init();
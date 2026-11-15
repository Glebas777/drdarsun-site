import { supabase } from './supabase-client.js';

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // 1. Заполняем профиль
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // 2. Загрузка заказов
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        try {
            const { data: orders, error } = await supabase
                .from('orders')
                .select('*')
                .eq('user_id', session.user.id)
                .order('created_at', { ascending: false });

            if (error || !orders || orders.length === 0) {
                ordersList.innerHTML = '<div class="empty-state">У вас пока нет заказов.</div>';
            } else {
                ordersList.innerHTML = orders.map(order => `
                    <div class="order-card">
                        <div class="order-header">
                            <span>Заказ #${order.id.split('-')[0]}</span>
                            <span class="order-status">${order.status || 'В обработке'}</span>
                        </div>
                        <div class="order-items">${JSON.stringify(order.items)}</div>
                        <div style="margin-top:10px; font-weight:600; color:var(--accent);">Итого: ${order.total} ₽</div>
                    </div>
                `).join('');
            }
        } catch (e) {
            console.error('Ошибка заказов:', e);
            ordersList.innerHTML = '<div class="empty-state">Ошибка загрузки заказов.</div>';
        }
    }

    // 3. Переключение вкладок
    const navBtns = document.querySelectorAll('.profile-nav-btn');
    const tabs = document.querySelectorAll('.profile-tab');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            navBtns.forEach(b => b.classList.remove('active'));
            tabs.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');

            const tabId = btn.getAttribute('data-tab');
            const targetTab = document.getElementById('tab-' + tabId);
            if (targetTab) targetTab.classList.add('active');

            if (tabId === 'logout') {
                supabase.auth.signOut().then(() => window.location.href = 'index.html');
            }
        });
    });

    // 4. Меню (троеточие)
    const menuToggle = document.getElementById('menu-toggle');
    const menuDropdown = document.getElementById('menu-dropdown');
    if (menuToggle && menuDropdown) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.classList.toggle('active');
        });
        document.addEventListener('click', (e) => {
            if (!menuToggle.contains(e.target) && !menuDropdown.contains(e.target)) {
                menuDropdown.classList.remove('active');
            }
        });
    }

    // 5. Смена имени
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

    // 6. Смена пароля
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

// Обновляем хедер, если он есть на странице
async function updateHeaderAuth() {
    const container = document.getElementById('auth-buttons');
    if (!container) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        container.innerHTML = `
            <a href="cart.html" class="header__btn" style="text-decoration: none; margin-right: 10px;">Корзина</a>
            <a href="profile.html" class="header__btn" style="text-decoration: none;">Личный кабинет</a>
        `;
    } else {
        container.innerHTML = `<a href="login.html" class="header__btn" style="text-decoration: none;">Войти</a>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    updateHeaderAuth();
});
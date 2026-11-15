import { supabase } from './supabase-client.js';

async function init() {
    // 1. ПРОВЕРКА СЕССИИ
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // 2. ЗАПОЛНЕНИЕ ДАННЫХ
    const userNameEl = document.getElementById('user-name');
    const userEmailEl = document.getElementById('user-email');
    if (userNameEl) userNameEl.textContent = session.user.user_metadata.full_name || 'Гость';
    if (userEmailEl) userEmailEl.textContent = session.user.email;

    // 3. ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК (ГЛАВНАЯ МАГИЯ)
    const navBtns = document.querySelectorAll('.profile-nav-btn');
    const tabs = document.querySelectorAll('.profile-tab');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Убираем активный класс у всех кнопок и вкладок
            navBtns.forEach(b => b.classList.remove('active'));
            tabs.forEach(t => t.classList.remove('active'));

            // Добавляем активный класс текущей кнопке
            btn.classList.add('active');

            // Показываем нужную вкладку
            const tabId = btn.getAttribute('data-tab');
            const targetTab = document.getElementById('tab-' + tabId);
            if (targetTab) {
                targetTab.classList.add('active');
            }

            // Если нажали "Выйти" — выходим
            if (tabId === 'logout') {
                supabase.auth.signOut().then(() => {
                    window.location.href = 'index.html';
                });
            }
        });
    });

    // 4. СМЕНА ИМЕНИ
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
                if (userNameEl) userNameEl.textContent = newName;
            }
        });
    }

    // 5. СМЕНА ПАРОЛЯ
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

// Запускаем после загрузки страницы
document.addEventListener('DOMContentLoaded', init);
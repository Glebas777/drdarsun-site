import { supabase } from './supabase-client.js';

async function init() {
    // Ждем сессию (на случай, если вернулись с OAuth)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = 'login.html';

    // 1. Заполняем данные
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // 2. Смена имени
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        document.getElementById('settings-name').value = session.user.user_metadata.full_name || '';
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = document.getElementById('settings-name').value;
            const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
            
            if (error) {
                alert('Ошибка: ' + error.message);
            } else {
                alert('Имя обновлено!');
                document.getElementById('user-name').textContent = newName;
            }
        });
    }

    // 3. Смена пароля
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('new-password').value;

            if (newPassword.length < 6) {
                return alert('Пароль должен быть не менее 6 символов');
            }

            const { error } = await supabase.auth.updateUser({ password: newPassword });
            
            if (error) {
                alert('Ошибка: ' + error.message);
            } else {
                alert('Пароль успешно изменен!');
                passwordForm.reset();
            }
        });
    }

    // 4. SOS (Меня взломали)
    document.getElementById('sos-btn')?.addEventListener('click', async () => {
        if (!confirm('Выкинуть вас со всех устройств?')) return;
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
}
init();
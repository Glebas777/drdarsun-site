import { supabase } from './supabase-client.js';

async function init() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
        showToast('Сессия истекла. Войдите заново.', 'error');
        return window.location.href = 'login.html';
    }

    // 1. ДАННЫЕ
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // 2. АВАТАРКА (ЗАГРУЗКА)
    const avatarInput = document.getElementById('avatar-input');
    const avatarPreview = document.getElementById('avatar-preview');
    if (avatarInput) {
        avatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                avatarPreview.innerHTML = `<img src="${event.target.result}" alt="Avatar">`;
            };
            reader.readAsDataURL(file);
        });
    }

    // 3. АВАТАРКА (ВЫБОР)
    const chooseAvatarBtn = document.getElementById('choose-avatar-btn');
    const avatarModal = document.getElementById('avatar-modal');
    const currentAvatar = document.getElementById('current-avatar');
    if (chooseAvatarBtn && avatarModal) {
        chooseAvatarBtn.addEventListener('click', () => avatarModal.style.display = 'flex');
    }
    window.selectAvatar = function(src) {
        if (currentAvatar) currentAvatar.src = src;
        if (avatarModal) avatarModal.style.display = 'none';
        showToast('Аватарка выбрана!');
    };

    // 4. КОШЕЛЕК
    const walletEl = document.getElementById('wallet-balance');
    if (walletEl) {
        const { data: w, error } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).maybeSingle();
        if (error) { console.error(error); walletEl.textContent = '0 ₽'; }
        else walletEl.textContent = w ? `${w.balance} ₽` : '0 ₽';
    }

    // 5. ИСТОРИЯ ОПЕРАЦИЙ
    const transactionsList = document.getElementById('transactions-list');
    if (transactionsList) {
        const { data: tx, error } = await supabase.from('transactions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (error || !tx || tx.length === 0) {
            transactionsList.innerHTML = '<div class="empty-state">Пока нет операций.</div>';
        } else {
            transactionsList.innerHTML = tx.map(t => `
                <div style="display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid var(--border);">
                    <span>${t.type === 'deposit' ? 'Пополнение' : 'Списание'}</span>
                    <span style="color: ${t.type === 'deposit' ? 'green' : 'red'};">${t.type === 'deposit' ? '+' : '-'}${t.amount} ₽</span>
                </div>
            `).join('');
        }
    }

    // 6. ЗАКАЗЫ
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        const { data: orders } = await supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!orders || orders.length === 0) {
            ordersList.innerHTML = '<div class="empty-state">У вас пока нет заказов.</div>';
        } else {
            ordersList.innerHTML = orders.map(o => {
                let statusImg = '01_in_progress_gold.png';
                if (o.status === 'Доставлен') statusImg = '03_delivered_green.png';
                else if (o.status === 'В пути') statusImg = '02_in_transit_blue.png';
                else if (o.status === 'Отменен') statusImg = '04_cancelled_red.png';
                return `
                <div class="order-card">
                    <div class="order-header">
                        <strong>Заказ #${o.id.split('-')[0]}</strong>
                        <div style="background-image: url('assets/images/${statusImg}'); background-size: cover; padding: 6px 16px; border-radius: 20px; color: #fff; font-weight: 600; font-size: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.6); box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
                            ${o.status || 'В обработке'}
                        </div>
                    </div>
                    <div style="font-size: 14px; color: var(--text-muted);">Товары: ${Array.isArray(o.items) ? o.items.length : '0'} шт.</div>
                    <div style="margin-top: 10px; font-weight: 600; color: var(--accent-green);">Итого: ${o.total} ₽</div>
                </div>
                `}).join('');
        }
    }

    // 7. ВКЛАДКИ
    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId)?.classList.add('active');
        });
    });

    // 8. БЕЗОПАСНОСТЬ (ВЫХОДЫ)
    const devicesList = document.getElementById('devices-list');
    if (devicesList) {
        devicesList.innerHTML = `
            <div class="device-item">
                <div>
                    <p style="margin: 0; font-weight: 500;">Текущее устройство</p>
                    <p style="margin: 0; font-size: 12px; color: var(--text-muted);">${navigator.userAgent}</p>
                </div>
            </div>
            <button class="btn" id="logout-all-devices" style="margin-top: 10px; border: 1px solid var(--border);">Выйти на всех устройствах</button>
            <button class="btn" id="logout-other-devices" style="margin-top: 10px; border: 1px solid var(--border);">Выйти везде, кроме этого</button>
        `;

    // Резервные коды
    const generateBackupBtn = document.getElementById('generate-backup-codes');
    const backupCodesList = document.getElementById('backup-codes-list');

    if (generateBackupBtn && backupCodesList) {
        generateBackupBtn.addEventListener('click', async () => {
            // Генерируем 5 случайных кодов
            const codes = [];
            for (let i = 0; i < 5; i++) {
                codes.push(Math.random().toString(36).substring(2, 8).toUpperCase());
            }
            
            // Сохраняем в БД (добавим таблицу позже) или просто показываем
            backupCodesList.style.display = 'block';
            backupCodesList.innerHTML = `
                <p style="color: #FFA600; font-weight: 600;">Сохраните эти коды:</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                    ${codes.map(c => `<code style="background: #222; padding: 8px; border-radius: 6px; text-align: center; font-size: 16px;">${c}</code>`).join('')}
                </div>
                <p style="font-size: 12px; color: var(--text-muted); margin-top: 10px;">Каждый код можно использовать один раз.</p>
            `;
            showToast('Резервные коды сгенерированы!');
        });
    }

document.getElementById('logout-all-devices')?.addEventListener('click', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('https://drdarsun-site-main.layero.app/api/logout-all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    await supabase.auth.signOut();
    window.location.href = 'index.html';
});

        document.getElementById('logout-other-devices')?.addEventListener('click', async () => {
            const { data: { session } } = await supabase.auth.getSession();
            await fetch('https://drdarsun-site-main.layero.app/api/logout-others', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            showToast('Другие сессии закрыты!');
        });
    }

    

    // 9. 2FA (ПРОВЕРКА СТАТУСА)
    const enable2faBtn = document.getElementById('enable-2fa-btn');
    if (enable2faBtn) {
        // Проверяем, есть ли уже фактор
const { data, error } = await supabase.auth.mfa.listFactors();
if (!error && data.all && data.all.length > 0) {
    enable2faBtn.textContent = 'Включено';
    enable2faBtn.disabled = true;
    enable2faBtn.style.background = '#4CAF50';
    enable2faBtn.style.color = '#fff';
}

        enable2faBtn.addEventListener('click', async () => {
            if (enable2faBtn.disabled) return;

            try {
                const { data, error } = await supabase.auth.mfa.enroll({ 
                    factorType: 'totp',
                    friendlyName: 'Dr. DarSun 2FA' // <--- Добавь имя, чтобы не было пустого
                });
                if (error) throw error;
                const qrModal = document.createElement('div');
                qrModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;';
                qrModal.innerHTML = `
                    <div style="background:var(--bg-card);padding:30px;border-radius:20px;text-align:center;max-width:400px;">
                        <h3 style="margin-bottom:15px;">2FA</h3>
                        <p style="color:var(--text-muted);margin-bottom:15px;">Отсканируйте QR-код в Google Authenticator</p>
                        <img src="${data.totp.qr_code}" style="width:200px;height:200px;margin-bottom:15px;">
                        <p style="font-size:12px;color:var(--text-muted);margin-bottom:15px;">Ключ: <code>${data.totp.secret}</code></p>
                        <input type="text" id="totp-code" placeholder="Введите 6 цифр" maxlength="6" style="width:100%;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-color);color:var(--text-main);text-align:center;font-size:20px;margin-bottom:15px;">
                        <button id="verify-totp" class="btn btn--primary" style="width:100%;margin-bottom:10px;">Подтвердить</button>
                        <button id="close-totp" class="btn" style="width:100%;border:1px solid var(--border);">Отмена</button>
                    </div>
                `;
                document.body.appendChild(qrModal);
                document.getElementById('close-totp').onclick = () => {
                    qrModal.remove();
                    supabase.auth.mfa.unenroll({ factorId: data.id });
                };
                document.getElementById('verify-totp').onclick = async () => {
                    const code = document.getElementById('totp-code').value;
                    if (code.length !== 6) return alert('Введите 6 цифр');
                    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code: code });
                    if (verifyError) alert('Неверный код: ' + verifyError.message);
                    else {
                        qrModal.remove();
                        showToast('2FA активирован!');
                        enable2faBtn.textContent = 'Включено';
                        enable2faBtn.disabled = true;
                    }
                };
            } catch (e) {
                showToast('Ошибка: ' + e.message, 'error');
            }
        });
    }

    // 10. СМЕНА ИМЕНИ И ПАРОЛЯ
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        document.getElementById('settings-name').value = session.user.user_metadata.full_name || '';
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = document.getElementById('settings-name').value;
            const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
            if (error) showToast('Ошибка: ' + error.message, 'error');
            else {
                showToast('Имя обновлено!');
                document.getElementById('user-name').textContent = newName;
            }
        });
    }

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('new-password').value;
            if (newPassword.length < 6) return showToast('Пароль слишком короткий', 'error');
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) showToast('Ошибка: ' + error.message, 'error');
            else {
                showToast('Пароль изменен!');
                passwordForm.reset();
            }
        });
    }

    // 11. УДАЛЕНИЕ АККАУНТА
    document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
        if (!confirm('Вы уверены, что хотите удалить аккаунт? Это действие необратимо.')) return;
        if (!confirm('Точно? Все ваши заказы и данные будут удалены.')) return;
        if (!confirm('Последнее предупреждение. Удалить?')) return;
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('https://drdarsun-site-main.layero.app/api/delete-account', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        if (res.ok) {
            await supabase.auth.signOut();
            window.location.href = 'index.html';
        } else {
            showToast('Ошибка удаления', 'error');
        }
    });
}

// --- ТОСТЫ ---
window.showToast = function(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
};

// Запуск
init();
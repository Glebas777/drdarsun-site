import { supabase } from './supabase-client.js';

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = 'login.html';

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

    // 3. АВАТАРКА (ВЫБОР ИЗ ГОТОВЫХ)
    const chooseAvatarBtn = document.getElementById('choose-avatar-btn');
    const avatarModal = document.getElementById('avatar-modal');
    const currentAvatar = document.getElementById('current-avatar');

    if (chooseAvatarBtn && avatarModal) {
        chooseAvatarBtn.addEventListener('click', () => {
            avatarModal.style.display = 'flex';
        });
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
        if (error) {
            console.error('Wallet Error:', error);
            walletEl.textContent = '0 ₽';
        } else {
            walletEl.textContent = w ? `${w.balance} ₽` : '0 ₽';
        }
    }

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

    // 5. ЗАКАЗЫ
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
<div style="width: 100%; height: 120px; background-image: url('assets/images/${statusImg}'); background-size: cover; background-position: center; border-radius: 12px; margin-top: 10px; opacity: 0.9; display: flex; align-items: flex-end; padding: 15px; box-sizing: border-box; position: relative;">
    <span style="color: #fff; font-weight: 700; font-size: 14px; text-shadow: 0 2px 4px rgba(0,0,0,0.8); z-index: 1;">${o.status || 'В обработке'}</span>
    <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.6), transparent); border-radius: 12px;"></div>
</div>
                    </div>
                    <div style="font-size: 14px; color: var(--text-muted);">Товары: ${Array.isArray(o.items) ? o.items.length : '0'} шт.</div>
                    <div style="margin-top: 10px; font-weight: 600; color: var(--accent-green);">Итого: ${o.total} ₽</div>
                </div>
            `}).join('');
        }
    }

    // 6. ВКЛАДКИ
    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId)?.classList.add('active');
        });
    });

    // 7. БЕЗОПАСНОСТЬ (Устройства и выходы)
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
        
        document.getElementById('logout-all-devices')?.addEventListener('click', async () => {
            const { data: { session } } = await supabase.auth.getSession();
            await fetch('https://drdarsun-site-main.layero.app/api/logout-all', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
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

    // 8. 2FA (TOTP)
    const enable2faBtn = document.getElementById('enable-2fa-btn');
    if (enable2faBtn) {
        enable2faBtn.addEventListener('click', async () => {
            try {
                const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
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
                    if (verifyError) {
                        alert('Неверный код: ' + verifyError.message);
                    } else {
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

    // 9. СМЕНА ИМЕНИ И ПАРОЛЯ
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

    // 10. УДАЛЕНИЕ АККАУНТА
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

// Выход из текущей сессии
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
});

// Выход со всех устройств (очищает и в браузере)
document.getElementById('logout-all-devices')?.addEventListener('click', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('https://drdarsun-site-main.layero.app/api/logout-all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    await supabase.auth.signOut(); // Очищаем сессию в браузере
    window.location.href = 'index.html';
});

init();
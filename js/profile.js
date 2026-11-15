import { supabase } from './supabase-client.js';

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = 'login.html';

    // 1. ДАННЫЕ
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;
    
    const birthdateInput = document.getElementById('birthdate');
    if (birthdateInput) {
        birthdateInput.value = session.user.user_metadata.birthdate || '';
        birthdateInput.addEventListener('change', async () => {
            await supabase.auth.updateUser({ data: { birthdate: birthdateInput.value } });
            showToast('Дата рождения сохранена!');
        });
    }

    // 2. АВАТАРКА
    const avatarInput = document.getElementById('avatar-input');
    const avatarPreview = document.getElementById('avatar-preview');
    if (avatarInput) {
        avatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                avatarPreview.innerHTML = `<img src="${event.target.result}" alt="Avatar">`;
                // В идеале: загрузить в Supabase Storage и сохранить URL в профиль
            };
            reader.readAsDataURL(file);
        });
    }

    // 3. КОШЕЛЕК
    const walletEl = document.getElementById('wallet-balance');
    if (walletEl) {
        const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).single();
        walletEl.textContent = w ? `${w.balance} ₽` : '0 ₽';
    }

    // 4. ИСТОРИЯ ОПЕРАЦИЙ
    const transList = document.getElementById('transactions-list');
    if (transList) {
        const { data: trans } = await supabase.from('transactions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!trans || trans.length === 0) {
            transList.innerHTML = '<p style="color: var(--text-muted);">Пока нет операций.</p>';
        } else {
            transList.innerHTML = trans.map(t => `
                <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border);">
                    <span>${t.type === 'deposit' ? 'Пополнение' : 'Оплата'}</span>
                    <span style="color: ${t.type === 'deposit' ? '#4CAF50' : '#F44336'};">${t.type === 'deposit' ? '+' : '-'}${t.amount} ₽</span>
                    <span style="font-size: 12px; color: var(--text-muted);">${new Date(t.created_at).toLocaleDateString()}</span>
                </div>
            `).join('');
        }
    }

    // 5. ЗАКАЗЫ (С КРАСИВЫМИ СТАТУСАМИ)
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        const { data: orders } = await supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!orders || orders.length === 0) {
            ordersList.innerHTML = '<div class="empty-state">У вас пока нет заказов.</div>';
        } else {
            ordersList.innerHTML = orders.map(o => {
                const statusClass = o.status === 'Доставлен' ? 'status-delivered' : 
                                   o.status === 'В пути' ? 'status-shipped' : 'status-processing';
                return `
                <div class="order-card">
                    <div class="order-header">
                        <strong>Заказ #${o.id.split('-')[0]}</strong>
                        <span class="status-badge ${statusClass}">${o.status || 'В обработке'}</span>
                    </div>
                    <div style="font-size: 14px; color: var(--text-muted);">Товары: ${JSON.parse(o.items).length} шт.</div>
                    <div style="margin-top: 10px; font-weight: 600; color: var(--accent-green);">Итого: ${o.total} ₽</div>
                    <button class="btn btn--primary" style="margin-top: 10px; width: 100%;" onclick="alert('Повтор заказа в разработке')">Повторить заказ</button>
                </div>
            `}).join('');
        }
    }

    // 6. ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId)?.classList.add('active');
        });
    });

    // 7. УСТРОЙСТВА И СЕССИИ
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
            const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
            if (error) return showToast('Ошибка: ' + error.message, 'error');
            
            // Показываем QR-код (SVG) и секрет
            const qrModal = document.createElement('div');
            qrModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;';
            qrModal.innerHTML = `
                <div style="background:var(--bg-card);padding:30px;border-radius:20px;text-align:center;max-width:400px;">
                    <h3 style="margin-bottom:15px;">Brezel's Guard</h3>
                    <p style="color:var(--text-muted);margin-bottom:15px;">Отсканируйте QR-код в Google Authenticator</p>
                    <img src="${data.totp.qr_code}" style="width:200px;height:200px;margin-bottom:15px;">
                    <p style="font-size:12px;color:var(--text-muted);margin-bottom:15px;">Секретный ключ: <code>${data.totp.secret}</code></p>
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
                    showToast('🛡️ Brezel\'s Guard активирован!');
                    enable2faBtn.textContent = 'Включено';
                    enable2faBtn.disabled = true;
                }
            };
        });
    }

    // 9. РЕЗЕРВНЫЕ КОДЫ
    const generateCodesBtn = document.getElementById('generate-backup-codes');
    if (generateCodesBtn) {
        generateCodesBtn.addEventListener('click', () => {
            const codes = Array.from({ length: 5 }, () => Math.random().toString(36).substring(2, 8).toUpperCase());
            const list = document.getElementById('backup-codes-list');
            list.style.display = 'block';
            list.innerHTML = `<p style="color: var(--accent-gold);">Сохраните эти коды:</p>` + codes.map(c => `<div style="font-family: monospace; padding: 5px; font-size: 16px;">${c}</div>`).join('');
            showToast('Коды сгенерированы!');
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

    // 12. PASSKEY (FACE ID) — ВКЛЮЧАЕМ, ЕСЛИ ПОДДЕРЖИВАЕТСЯ
    const passkeyBtn = document.getElementById('enable-passkey-btn');
    if (passkeyBtn) {
        passkeyBtn.addEventListener('click', async () => {
            try {
                const { data, error } = await supabase.auth.registerPasskey();
                if (error) throw error;
                showToast('Passkey (Face ID) активирован!');
                passkeyBtn.textContent = 'Включено';
                passkeyBtn.disabled = true;
            } catch (e) {
                showToast('Ошибка: ' + e.message, 'error');
            }
        });
    }
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

document.addEventListener('DOMContentLoaded', init);
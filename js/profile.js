import { supabase } from './supabase-client.js';

async function init() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        showToast('Сессия истекла. Войдите заново.', 'error');
        return window.location.href = 'login.html';
    }

    // 1. ДАННЫЕ
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // 2. АВАТАРКА (ЗАГРУЗКА)
    const avatarInput = document.getElementById('avatar-input');
    const currentAvatar = document.getElementById('current-avatar');
    const editorModal = document.getElementById('avatar-editor-modal');
    const editorImage = document.getElementById('editor-image');
    const cropArea = document.getElementById('crop-area');
    const editorSave = document.getElementById('editor-save');
    const editorCancel = document.getElementById('editor-cancel');

    // Загружаем текущую аватарку
    if (currentAvatar) {
        const { data: w } = await supabase.from('wallets').select('avatar_url').eq('user_id', session.user.id).maybeSingle();
        if (w && w.avatar_url) currentAvatar.src = w.avatar_url;
    }

    let isDragging = false;
    let startX = 0, startY = 0;
    let imgX = 0, imgY = 0;

    if (avatarInput) {
        avatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) {
                showToast('Файл слишком большой. Максимум 10 МБ.', 'error');
                avatarInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                editorImage.src = event.target.result;
                editorImage.style.transform = 'translate(0px, 0px)';
                imgX = 0; imgY = 0;
                editorModal.style.display = 'flex';
            };
            reader.readAsDataURL(file);
        });
    }

    if (cropArea) {
        cropArea.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - imgX;
            startY = e.clientY - imgY;
            cropArea.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            imgX = e.clientX - startX;
            imgY = e.clientY - startY;
            editorImage.style.transform = `translate(${imgX}px, ${imgY}px)`;
        });
        window.addEventListener('mouseup', () => {
            isDragging = false;
            cropArea.style.cursor = 'grab';
        });
    }

    if (editorSave) {
        editorSave.addEventListener('click', async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 300;
            const ctx = canvas.getContext('2d');
            ctx.beginPath();
            ctx.arc(150, 150, 150, 0, Math.PI * 2);
            ctx.clip();

            const img = new Image();
            img.onload = async () => {
                const drawX = (canvas.width - img.width) / 2 + imgX;
                const drawY = (canvas.height - img.height) / 2 + imgY;
                ctx.drawImage(img, drawX, drawY, img.width, img.height);

                const base64 = canvas.toDataURL('image/jpeg', 0.8);

                const { error } = await supabase
                    .from('wallets')
                    .upsert({ user_id: session.user.id, avatar_url: base64 }, { onConflict: 'user_id' });

                if (error) showToast('Ошибка: ' + error.message, 'error');
                else {
                    currentAvatar.src = base64;
                    showToast('Аватарка обновлена!');
                    editorModal.style.display = 'none';
                }
            };
            img.src = editorImage.src;
        });
    }

    if (editorCancel) {
        editorCancel.addEventListener('click', () => {
            editorModal.style.display = 'none';
            avatarInput.value = '';
        });
    }

    // 3. КОШЕЛЕК
    const walletEl = document.getElementById('wallet-balance');
    if (walletEl) {
        const { data: w, error } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).maybeSingle();
        if (error) { console.error(error); walletEl.textContent = '0 ₽'; }
        else walletEl.textContent = w ? `${w.balance} ₽` : '0 ₽';
    }

    // 4. ИСТОРИЯ ОПЕРАЦИЙ
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

    // --- УСТРОЙСТВА ---
    const devicesList = document.getElementById('devices-list');
    if (devicesList) {
        // Генерируем или получаем ключ устройства
        let deviceKey = localStorage.getItem('device_key');
        if (!deviceKey) {
            deviceKey = 'dev_' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem('device_key', deviceKey);
        }

        // Определяем имя устройства (браузер + ОС)
        const deviceName = navigator.userAgent.split(' ').slice(0, 2).join(' ');

        // Сохраняем/обновляем устройство в БД
        await supabase.from('devices').upsert({
            user_id: session.user.id,
            device_key: deviceKey,
            device_name: deviceName,
            last_active: new Date().toISOString()
        }, { onConflict: 'device_key' });

        // Загружаем список устройств
        const { data: devices, error } = await supabase
            .from('devices')
            .select('*')
            .eq('user_id', session.user.id)
            .order('last_active', { ascending: false });

        if (error || !devices || devices.length === 0) {
            devicesList.innerHTML = '<div class="empty-state">Нет активных устройств.</div>';
        } else {
            devicesList.innerHTML = devices.map(d => `
                <div class="device-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 8px;">
                    <div>
                        <p style="margin: 0; font-weight: 500; color: #fff;">${d.device_name}</p>
                        <p style="margin: 0; font-size: 12px; color: var(--text-muted);">${new Date(d.last_active).toLocaleString('ru-RU')}</p>
                    </div>
                    ${d.device_key === deviceKey ? '<span style="color: #4CAF50; font-size: 12px;">Текущее</span>' : ''}
                </div>
            `).join('');
        }

        // Кнопки выхода
        const logoutAllBtn = document.createElement('button');
        logoutAllBtn.className = 'btn';
        logoutAllBtn.style = 'margin-top: 10px; border: 1px solid var(--border);';
        logoutAllBtn.textContent = 'Выйти на всех устройствах';
        logoutAllBtn.onclick = async () => {
            await supabase.auth.signOut();
            window.location.href = 'index.html';
        };
        devicesList.appendChild(logoutAllBtn);
    }

    // 8. 2FA
    const enable2faBtn = document.getElementById('enable-2fa-btn');
    if (enable2faBtn) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        if (factors?.totp?.length > 0) {
            enable2faBtn.textContent = 'Включено';
            enable2faBtn.disabled = true;
            enable2faBtn.style.background = '#4CAF50';
            enable2faBtn.style.color = '#fff';
        }

        enable2faBtn.addEventListener('click', async () => {
            if (enable2faBtn.disabled) return;
            try {
                const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Dr. DarSun 2FA' });
                if (error) throw error;
                const qrModal = document.createElement('div');
                qrModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;';
                qrModal.innerHTML = `
                    <div style="background:var(--bg-card);padding:30px;border-radius:20px;text-align:center;max-width:400px;">
                        <h3 style="margin-bottom:15px;">2FA</h3>
                        <p style="color:var(--text-muted);margin-bottom:15px;">Отсканируйте QR-код в Яндекс.Ключ или Google Authenticator</p>
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
                    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code });
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

    // 10. УДАЛЕНИЕ
    document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
        if (!confirm('Удалить аккаунт? Это необратимо.')) return;
        if (!confirm('Точно? Все данные будут удалены.')) return;
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

const newPasswordInput = document.getElementById('new-password');
if (newPasswordInput) {
    // Легкость (мгновенно)
    newPasswordInput.addEventListener('input', () => {
        const val = newPasswordInput.value;
        const hintLength = document.getElementById('hint-length');
        const hintUpper = document.getElementById('hint-upper');
        const hintDigit = document.getElementById('hint-digit');

        if (val.length >= 6) {
            hintLength.innerHTML = '✅ Минимум 6 символов';
            hintLength.style.color = '#4CAF50';
        } else {
            hintLength.innerHTML = '❌ Минимум 6 символов';
            hintLength.style.color = '#888';
        }

        if (/[A-Z]/.test(val)) {
            hintUpper.innerHTML = '✅ Заглавная буква';
            hintUpper.style.color = '#4CAF50';
        } else {
            hintUpper.innerHTML = '❌ Заглавная буква';
            hintUpper.style.color = '#888';
        }

        if (/[0-9]/.test(val)) {
            hintDigit.innerHTML = '✅ Цифра';
            hintDigit.style.color = '#4CAF50';
        } else {
            hintDigit.innerHTML = '❌ Цифра';
            hintDigit.style.color = '#888';
        }
    });

    // Проверка на утечки (при потере фокуса)
    newPasswordInput.addEventListener('blur', async () => {
        const val = newPasswordInput.value;
        if (val.length < 6) return;

        const hintPwned = document.getElementById('hint-pwned');
        hintPwned.innerHTML = '⏳ Проверка на утечки...';
        hintPwned.style.color = '#888';

        try {
            // 1. Хешируем пароль (SHA-1)
            const msgBuffer = new TextEncoder().encode(val);
            const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

            // 2. Берем первые 5 символов и остаток
            const prefix = hashHex.substring(0, 5);
            const suffix = hashHex.substring(5);

            // 3. Отправляем только префикс в HIBP
            const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
            const text = await response.text();
            const lines = text.split('\n');

            let isPwned = false;
            let count = 0;

            for (const line of lines) {
                const [lineSuffix, lineCount] = line.split(':');
                if (lineSuffix === suffix) {
                    isPwned = true;
                    count = parseInt(lineCount);
                    break;
                }
            }

            if (isPwned) {
                hintPwned.innerHTML = `❌ Пароль слит ${count} раз. Придумай другой.`;
                hintPwned.style.color = '#F44336';
            } else {
                hintPwned.innerHTML = '✅ Пароль не найден в утечках';
                hintPwned.style.color = '#4CAF50';
            }
        } catch (e) {
            hintPwned.innerHTML = '⚠️ Не удалось проверить утечки';
            hintPwned.style.color = '#FFA600';
        }
    });
}

    // --- УВЕДОМЛЕНИЯ ---
    const notifyEmail = document.getElementById('notify-email');
    const changeNotifyBtn = document.getElementById('change-notify-email');
    const disableNotifyBtn = document.getElementById('disable-notify');

    if (notifyEmail) {
        const { data: settings } = await supabase.from('notification_settings').select('*').eq('user_id', session.user.id).maybeSingle();
        if (settings) {
            notifyEmail.textContent = session.user.email + (settings.email_enabled ? ' (включены)' : ' (отключены)');
        } else {
            notifyEmail.textContent = session.user.email;
            // Создаем настройки по умолчанию
            await supabase.from('notification_settings').insert({ user_id: session.user.id });
        }
    }

    changeNotifyBtn?.addEventListener('click', async () => {
        const newEmail = prompt('Введите новую почту для уведомлений:');
        if (!newEmail) return;
        const res = await fetch('https://drdarsun-site-main.layero.app/api/change-email', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ newEmail })
        });
        if (res.ok) showToast('Письмо для подтверждения отправлено!');
        else showToast('Ошибка смены почты', 'error');
    });

    disableNotifyBtn?.addEventListener('click', async () => {
        await supabase.from('notification_settings').update({ email_enabled: false }).eq('user_id', session.user.id);
        showToast('Уведомления отключены');
        if (notifyEmail) notifyEmail.textContent = session.user.email + ' (отключены)';
    });

    // --- РЕЗЕРВНЫЕ КОДЫ ---
    const generateBackupBtn = document.getElementById('generate-backup-codes');
    const backupCodesList = document.getElementById('backup-codes-list');

    if (generateBackupBtn && backupCodesList) {
        generateBackupBtn.addEventListener('click', async () => {
            // Генерируем 5 кодов
            const codes = [];
            for (let i = 0; i < 5; i++) {
                codes.push(Math.random().toString(36).substring(2, 8).toUpperCase());
            }

            // Сохраняем в БД
            const { error } = await supabase.from('backup_codes').insert(
                codes.map(c => ({ user_id: session.user.id, code: c }))
            );

            if (error) {
                showToast('Ошибка сохранения: ' + error.message, 'error');
                return;
            }

            // Показываем
            backupCodesList.style.display = 'block';
            backupCodesList.innerHTML = `
                <p style="color: #D4AF37; font-weight: 600; margin-bottom: 10px;">Сохраните эти коды (они больше не покажутся):</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    ${codes.map(c => `<code style="background: #0A0A0A; padding: 10px; border-radius: 8px; text-align: center; font-size: 16px; border: 1px solid #333; color: #fff;">${c}</code>`).join('')}
                </div>
                <p style="font-size: 12px; color: var(--text-muted); margin-top: 10px;">Каждый код можно использовать один раз.</p>
            `;
            showToast('Резервные коды сгенерированы!');
        });
    }

init();
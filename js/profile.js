import { supabase } from './supabase-client.js';

// Функция для тостов
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

// Функция выбора готовой аватарки (вызывается из HTML)
window.selectAvatar = async function(src) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
        .from('wallets')
        .upsert({ user_id: session.user.id, avatar_url: src }, { onConflict: 'user_id' });

    if (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } else {
        document.getElementById('current-avatar').src = src;
        document.getElementById('avatar-modal').style.display = 'none';
        showToast('Аватарка обновлена!');
    }
};

async function init() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        showToast('Сессия истекла. Войдите заново.', 'error');
        return window.location.href = 'login.html';
    }

    // 1. ДАННЫЕ
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;

    // 2. АВАТАРКА
    const avatarInput = document.getElementById('avatar-input');
    const currentAvatar = document.getElementById('current-avatar');
    const editorModal = document.getElementById('avatar-editor-modal');
    const editorImage = document.getElementById('editor-image');
    const cropArea = document.getElementById('crop-area');
    const editorSave = document.getElementById('editor-save');
    const editorCancel = document.getElementById('editor-cancel');
    const chooseAvatarBtn = document.getElementById('choose-avatar-btn');
    const avatarModal = document.getElementById('avatar-modal');

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

    if (chooseAvatarBtn) {
        chooseAvatarBtn.addEventListener('click', () => {
            avatarModal.style.display = 'flex';
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
        const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).maybeSingle();
        walletEl.textContent = w ? `${w.balance} ₽` : '0 ₽';
    }

    // 4. ИСТОРИЯ ОПЕРАЦИЙ
    const transactionsList = document.getElementById('transactions-list');
    if (transactionsList) {
        const { data: tx } = await supabase.from('transactions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!tx || tx.length === 0) {
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
            ordersList.innerHTML = orders.map(o => `
                <div class="order-card">
                    <div class="order-header">
                        <strong>Заказ #${o.id.split('-')[0]}</strong>
                        <span class="order-status" style="background: rgba(212,175,55,0.2); color: #D4AF37; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">${o.status || 'В обработке'}</span>
                </div>
                    <div style="font-size: 14px; color: var(--text-muted);">Товары: ${Array.isArray(o.items) ? o.items.length : '0'} шт.</div>
                    <div style="margin-top: 10px; font-weight: 600; color: var(--accent-green);">Итого: ${o.total} ₽</div>
                </div>
            `).join('');
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
    const refreshDevicesBtn = document.getElementById('refresh-devices-btn');

    async function loadDevices() {
        if (!devicesList) return;
        let deviceKey = localStorage.getItem('device_key');
        if (!deviceKey) {
            deviceKey = 'dev_' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem('device_key', deviceKey);
        }

        const deviceName = navigator.userAgent.split(' ').slice(0, 2).join(' ');

        await supabase.from('devices').upsert({
            user_id: session.user.id,
            device_key: deviceKey,
            device_name: deviceName,
            last_active: new Date().toISOString()
        }, { onConflict: 'device_key' });

        const { data: devices, error } = await supabase
            .from('devices')
            .select('*')
            .eq('user_id', session.user.id)
            .order('last_active', { ascending: false });

        // Рендерим список
        if (error || !devices || devices.length === 0) {
            devicesList.innerHTML = '<div class="empty-state">Нет активных устройств.</div>';
        } else {
            devicesList.innerHTML = devices.map(d => `
                <div class="device-item" data-key="${d.device_key}" data-name="${d.device_name}" data-date="${d.last_active}" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='#D4AF37'" onmouseout="this.style.borderColor='var(--border)'">
                    <div>
                        <p style="margin: 0; font-weight: 500; color: #fff;">${d.device_name}</p>
                        <p style="margin: 0; font-size: 12px; color: var(--text-muted);">${new Date(d.last_active).toLocaleString('ru-RU')}</p>
                    </div>
                    ${d.device_key === deviceKey ? '<span style="color: #4CAF50; font-size: 12px; font-weight: 600;">Текущее</span>' : ''}
                </div>
            `).join('');

            document.querySelectorAll('.device-item').forEach(item => {
                item.addEventListener('click', () => {
                    const key = item.dataset.key;
                    const name = item.dataset.name;
                    const date = item.dataset.date;

                    document.getElementById('modal-device-name').textContent = name;
                    document.getElementById('modal-device-date').textContent = new Date(date).toLocaleString('ru-RU');
                    document.getElementById('device-modal').style.display = 'flex';

                    document.getElementById('modal-copy-btn').onclick = () => {
                        const text = `Устройство: ${name}\nДата входа: ${new Date(date).toLocaleString('ru-RU')}\nКлюч: ${key}`;
                        navigator.clipboard.writeText(text).then(() => {
                            showToast('Данные скопированы!');
                            document.getElementById('device-modal').style.display = 'none';
                        });
                    };

                    document.getElementById('modal-end-btn').onclick = async () => {
                        await supabase.from('devices').delete().eq('device_key', key);
                        showToast('Сессия завершена');
                        document.getElementById('device-modal').style.display = 'none';
                        if (key === deviceKey) {
                            await supabase.auth.signOut();
                            window.location.href = 'index.html';
                        } else {
                            loadDevices();
                        }
                    };

                    document.getElementById('modal-close-btn').onclick = () => {
                        document.getElementById('device-modal').style.display = 'none';
                    };
                });
            });
        }

        // Добавляем кнопки ВНУТРИ функции, после рендера (они не пропадут)
        const controls = document.createElement('div');
        controls.style = 'display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px;';

        const logoutOtherBtn = document.createElement('button');
        logoutOtherBtn.className = 'btn';
        logoutOtherBtn.style = 'border: 1px solid var(--border);';
        logoutOtherBtn.textContent = 'Завершить все сессии, кроме этой';
logoutOtherBtn.onclick = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // 1. Удаляем все устройства, кроме текущего, из БД
    const currentKey = localStorage.getItem('device_key');
    await supabase.from('devices').delete().eq('user_id', session.user.id).neq('device_key', currentKey);

    // 2. Просим Layero отозвать все другие сессии
    try {
        await fetch('https://drdarsun-site-main.layero.app/api/logout-others', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
    } catch (e) {
        console.warn('Layero logout-others error:', e);
    }

    showToast('Все другие сессии завершены');
    loadDevices();
};

        const logoutAllBtn = document.createElement('button');
        logoutAllBtn.className = 'btn';
        logoutAllBtn.style = 'border: 1px solid #F44336; color: #F44336;';
        logoutAllBtn.textContent = 'Завершить все сессии (включая эту)';
logoutAllBtn.onclick = async () => {
    if (!confirm('Вы уверены? Все устройства будут выкинуты.')) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // 1. Удаляем все устройства
    await supabase.from('devices').delete().eq('user_id', session.user.id);

    // 2. Просим Layero отозвать ВСЕ сессии
    try {
        await fetch('https://drdarsun-site-main.layero.app/api/logout-all', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
    } catch (e) {
        console.warn('Layero logout-all error:', e);
    }

    // 3. Выходим сами
    await supabase.auth.signOut();
    window.location.href = 'index.html';
};

        controls.appendChild(logoutOtherBtn);
        controls.appendChild(logoutAllBtn);
        devicesList.appendChild(controls);
    }

    refreshDevicesBtn?.addEventListener('click', loadDevices);

    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.getAttribute('data-tab') === 'security') {
                loadDevices();
            }
        });
    });

    await loadDevices();

const toggle2fa = document.getElementById('2fa-toggle');
const status2fa = document.getElementById('2fa-status');

if (toggle2fa) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const has2fa = factors?.totp?.length > 0;
    toggle2fa.checked = has2fa;
    status2fa.textContent = has2fa ? 'Включена' : 'Отключена';

    toggle2fa.addEventListener('change', async () => {
        if (toggle2fa.checked) {
            // Включаем
            const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Dr. DarSun 2FA' });
            if (error) { toggle2fa.checked = false; return showToast('Ошибка: ' + error.message, 'error'); }

            const qrModal = document.createElement('div');
            qrModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;';
            qrModal.innerHTML = `
                <div style="background:var(--bg-card);padding:30px;border-radius:20px;text-align:center;max-width:400px;">
                    <h3>2FA</h3>
                    <p style="color:var(--text-muted);margin:10px 0;">Отсканируйте QR в приложении</p>
                    <img src="${data.totp.qr_code}" style="width:200px;height:200px;margin:10px 0;">
                    <input type="text" id="totp-code" placeholder="000000" maxlength="6" style="width:100%;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-color);color:var(--text-main);text-align:center;font-size:20px;margin-bottom:10px;">
                    <button id="verify-totp" class="btn btn--primary" style="width:100%;">Подтвердить</button>
                    <button id="close-totp" class="btn" style="width:100%;margin-top:10px;border:1px solid var(--border);">Отмена</button>
                </div>
            `;
            document.body.appendChild(qrModal);

            document.getElementById('close-totp').onclick = () => {
                qrModal.remove();
                toggle2fa.checked = false;
                supabase.auth.mfa.unenroll({ factorId: data.id });
            };

            document.getElementById('verify-totp').onclick = async () => {
                const code = document.getElementById('totp-code').value;
                const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code });
                if (verifyError) return alert('Неверный код: ' + verifyError.message);
                qrModal.remove();
                status2fa.textContent = 'Включена';
                showToast('2FA активирована!');
            };
        } else {
            // Отключаем — ОДИН вызов unenroll
            if (!confirm('Отключить 2FA? Аккаунт станет менее защищённым.')) {
                toggle2fa.checked = true;
                return;
            }

            const { data: factors } = await supabase.auth.mfa.listFactors();
            const totpFactor = factors?.totp?.[0];
            if (!totpFactor) {
                toggle2fa.checked = false;
                status2fa.textContent = 'Отключена';
                return;
            }

            const { error } = await supabase.auth.mfa.unenroll({ factorId: totpFactor.id });
            if (error) {
                showToast('Ошибка отключения: ' + error.message, 'error');
                toggle2fa.checked = true;
            } else {
                status2fa.textContent = 'Отключена';
                showToast('2FA полностью удалена');
            }
        }
    });
}


    // 10. НАСТРОЙКИ
    document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = document.getElementById('settings-name').value;
        const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
        if (error) showToast('Ошибка: ' + error.message, 'error');
        else {
            showToast('Имя обновлено!');
            document.getElementById('user-name').textContent = newName;
        }
    });

    document.getElementById('password-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('new-password').value;
        if (newPassword.length < 6) return showToast('Пароль слишком короткий', 'error');
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) showToast('Ошибка: ' + error.message, 'error');
        else {
            showToast('Пароль изменен!');
            document.getElementById('password-form').reset();
        }
    });

    // 11. УДАЛЕНИЕ
    document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
        if (!confirm('Удалить аккаунт? Это необратимо.')) return;
        if (!confirm('Точно? Все данные будут удалены.')) return;
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

document.getElementById('qr-login-btn')?.addEventListener('click', async () => {
    document.getElementById('qr-modal').style.display = 'flex';

    const qrToken = 'qr_' + Math.random().toString(36).substring(2, 15);
    const qrUrl = `https://drdarsun.ru/qr-confirm?token=${qrToken}`;

    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';

    new QRCode(qrContainer, {
        text: qrUrl,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
});

// --- QR В БЕЗОПАСНОСТИ ---
const showMyQrBtn = document.getElementById('show-my-qr-btn');
const scanQrBtn = document.getElementById('scan-qr-btn');
const myQrContainer = document.getElementById('my-qr-container');
const qrScanResult = document.getElementById('qr-scan-result');

showMyQrBtn?.addEventListener('click', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const token = 'qr_' + Math.random().toString(36).substring(2, 15);
    const url = `https://drdarsun.ru/qr-confirm?token=${token}`;

    myQrContainer.style.display = 'block';
    myQrContainer.innerHTML = '';

    new QRCode(myQrContainer, {
        text: url,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
});

scanQrBtn?.addEventListener('click', async () => {
    qrScanResult.textContent = 'Запрос доступа к камере...';

    try {
        const html5QrCode = new Html5Qrcode("qr-scan-result");
        await html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 250 },
            (decodedText) => {
                qrScanResult.innerHTML = `Отсканировано: <strong>${decodedText}</strong>`;
                html5QrCode.stop();
            },
            () => {}
        );
    } catch (err) {
        qrScanResult.textContent = 'Ошибка камеры: ' + err;
    }
});

// --- ПРОСТОЙ ВЫХОД (не завершение сессии, а выход) ---
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (!confirm('Выйти из аккаунта?')) return;

    // Удаляем текущее устройство из БД (чтобы не висело в списке)
    const deviceKey = localStorage.getItem('device_key');
    if (deviceKey) {
        await supabase.from('devices').delete().eq('device_key', deviceKey);
    }

    // Выходим из Supabase
    await supabase.auth.signOut();

    // Перенаправляем на главную
    window.location.href = 'index.html';
});

// Включить уведомления
document.getElementById('enable-notify-btn')?.addEventListener('click', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase.functions.invoke('send-notification', {
        body: {
            to: session.user.email,
            subject: 'Уведомления Dr. DarSun включены',
            html: '<h2>Вы подписались на уведомления</h2><p>Теперь вы будете получать новости о заказах.</p>'
        }
    });

    if (error) {
        console.error('Function error:', error);
        showToast('Ошибка: ' + error.message, 'error');
    } else {
        showToast('Уведомления включены! Проверьте почту.');
    }
});

init();
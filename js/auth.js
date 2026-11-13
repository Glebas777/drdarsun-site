import { supabase } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Вкладки
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  tabLogin?.addEventListener('click', () => {
    tabLogin.style.borderBottom = '2px solid var(--accent)';
    tabRegister.style.borderBottom = 'none';
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
  });

  tabRegister?.addEventListener('click', () => {
    tabRegister.style.borderBottom = '2px solid var(--accent)';
    tabLogin.style.borderBottom = 'none';
    registerForm.style.display = 'flex';
    loginForm.style.display = 'none';
  });

  // 2. Вход по паролю
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) window.showToast('Ошибка: ' + error.message, 'error');
    else window.location.href = '/profile.html';
  });

  // 3. OAuth (Google, Yandex, Telegram)
  const handleOAuth = async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({ 
      provider, 
      options: { redirectTo: window.location.origin + '/profile.html' } 
    });
    if (error) window.showToast('Ошибка входа: ' + error.message, 'error');
  };

  document.getElementById('btn-google')?.addEventListener('click', () => handleOAuth('google'));
  document.getElementById('btn-yandex')?.addEventListener('click', () => handleOAuth('custom:yandex'));
  document.getElementById('btn-telegram')?.addEventListener('click', async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({ 
      provider: 'custom:telegram', 
      options: { skipBrowserRedirect: true, redirectTo: window.location.origin + '/profile.html' } 
    });
    if (data) window.location.href = data.url;
    else if (error) window.showToast('Ошибка входа: ' + error.message, 'error');
  });

  // 4. Меню и Резервный код
  const dotsBtn = document.getElementById('dotsBtn');
  const dropdownMenu = document.getElementById('dropdownMenu');
  const backupModal = document.getElementById('backupModal');

  dotsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('active');
  });
  document.addEventListener('click', () => dropdownMenu?.classList.remove('active'));

  document.getElementById('menuBackup')?.addEventListener('click', () => {
    dropdownMenu.classList.remove('active');
    backupModal.classList.add('active');
  });

  document.getElementById('menuQr')?.addEventListener('click', () => {
    dropdownMenu.classList.remove('active');
    window.showToast('QR-вход скоро появится', 'info');
  });

  backupModal?.addEventListener('click', (e) => {
    if (e.target === backupModal) backupModal.classList.remove('active');
  });

  document.getElementById('submitBackupBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('backupEmail').value;
    const code = document.getElementById('backupCode').value;
    if (!email || !code) return window.showToast('Заполните поля', 'error');
    
    const btn = document.getElementById('submitBackupBtn');
    btn.disabled = true; btn.textContent = 'Проверка...';
    
    try {
      const res = await fetch('/api/auth/backup-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const data = await res.json();
      if (res.ok && data.action_link) window.location.href = data.action_link;
      else window.showToast(data.error || 'Неверный код', 'error');
    } catch (e) {
      window.showToast('Ошибка сети', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Войти';
    }
  });
});
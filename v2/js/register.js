document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const channel = document.querySelector('input[name="channel"]:checked').value;

    // 1. Регистрация в Supabase
    const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name } }
    });

    if (error) return alert(error.message);

    // 2. Отправка кода через Layero
    try {
        await fetch('https://drdarsun-site-main.layero.app/api/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, method: channel })
        });
        
        // Показываем блок ввода кода
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('verify-block').style.display = 'block';
        
    } catch (e) {
        alert('Ошибка отправки кода');
    }
});

document.getElementById('verify-btn')?.addEventListener('click', async () => {
    const code = document.getElementById('verify-code').value;
    const email = document.getElementById('reg-email').value;

    try {
        const res = await fetch('https://drdarsun-site-main.layero.app/api/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        
        const data = await res.json();
        if (data.success) {
            alert('Аккаунт подтвержден! Теперь вы можете войти.');
            window.location.href = 'login.html';
        } else {
            alert(data.message);
        }
    } catch (e) {
        alert('Ошибка проверки кода');
    }
});
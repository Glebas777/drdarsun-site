const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';
const SUPABASE_ORIGIN = 'https://rrpcqrvkhmlrdqvffnax.supabase.co';
const LAYERO_ORIGIN = 'https://drdarsun-site-main.layero.app';

// КОСТЫЛЬ ДЛЯ ЯНДЕКСА
app.get('/auth/v1/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('https://drdarsun.ru/login.html?error=no_code');

    try {
        // 1. Меняем код на токен у Яндекса
        const tokenRes = await fetch('https://oauth.yandex.ru/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: process.env.YANDEX_CLIENT_ID,
                client_secret: process.env.YANDEX_SECRET_ID
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('No token');

        // 2. Забираем профиль (там default_email)
        const userRes = await fetch('https://login.yandex.ru/info?format=json', {
            headers: { 'Authorization': `OAuth ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        const email = userData.default_email;

        if (!email) throw new Error('No email');

        // 3. Создаем/логиним пользователя в Supabase через Admin API
        // ВАЖНО: Нужен SUPABASE_SERVICE_ROLE_KEY в переменных Layero!
        const supabaseRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                email_confirm: true,
                user_metadata: { full_name: userData.real_name || userData.display_name }
            })
        });
        
        const supabaseUser = await supabaseRes.json();
        
        // Если юзер уже есть (ошибка 422), просто редиректим (сессию создаст клиент)
        // В идеале тут нужно генерировать magic link, но для простоты редиректим
        
        res.redirect('https://drdarsun-site-main.layero.app/profile.html');
        
    } catch (e) {
        console.error(e);
        res.redirect('https://drdarsun.ru/login.html?error=yandex_fail');
    }
});

app.all('*', async (req, res) => {
    try {
        const targetUrl = `${CF_WORKER}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { ...req.headers, host: 'supabase-proxy.turgleb7.workers.dev' },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
            redirect: 'manual'
        });
        
        // Сначала копируем все заголовки, КРОМЕ location
        res.status(response.status);
        response.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'location'].includes(key)) {
                res.setHeader(key, value);
            }
        });

        // Потом принудительно переписываем location
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            let location = response.headers.get('location');
            if (location) {
                // Меняем и обычный, и закодированный URL
                location = location.replace(SUPABASE_ORIGIN, LAYERO_ORIGIN);
                location = location.replace(encodeURIComponent(SUPABASE_ORIGIN), encodeURIComponent(LAYERO_ORIGIN));
                res.setHeader('location', location);
            }
        }
        
        const data = await response.text();
        res.send(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Proxy error' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
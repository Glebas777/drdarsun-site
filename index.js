const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';
const LAYERO_ORIGIN = 'https://drdarsun-site-main.layero.app';

// ==========================================
// 1. КОСТЫЛЬ ДЛЯ ЯНДЕКСА (ПЕРЕХВАТЫВАЕТ ВХОД)
// ==========================================
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

        // 2. Забираем профиль (email)
        const userRes = await fetch('https://login.yandex.ru/info?format=json', {
            headers: { 'Authorization': `OAuth ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        const email = userData.default_email;
        if (!email) throw new Error('No email');

        // 3. Генерируем Magic Link (ОДИН РАЗ)
        const linkRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'magiclink',
                email: email,
                options: {
                    redirect_to: 'https://drdarsun.ru/profile.html'
                }
            })
        });
        
        const linkData = await linkRes.json();
        
        // Если ссылка не сгенерировалась (юзер не создан) — создаем и генерируем снова
        if (linkData.error || !linkData.action_link) {
            await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
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

            const retryLinkRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
                method: 'POST',
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'magiclink',
                    email: email,
                    options: { redirect_to: 'https://drdarsun.ru/profile.html' }
                })
            });
            const retryData = await retryLinkRes.json();
            return res.redirect(retryData.action_link);
        }

        // Редиректим на сгенерированную ссылку
        res.redirect(linkData.action_link);

    } catch (e) {
        console.error('Yandex Auth Error:', e);
        res.redirect('https://drdarsun.ru/login.html?error=yandex_fail');
    }
});

// ==========================================
// 2. УНИВЕРСАЛЬНЫЙ ПРОКСИ ДЛЯ ВСЕГО ОСТАЛЬНОГО
// ==========================================
app.all('*', async (req, res) => {
    try {
        const targetUrl = `${CF_WORKER}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { ...req.headers, host: 'supabase-proxy.turgleb7.workers.dev' },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
            redirect: 'manual'
        });
        
        // Копируем заголовки, КРОМЕ location
        res.status(response.status);
        response.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'location'].includes(key)) {
                res.setHeader(key, value);
            }
        });

        // Переписываем Location (для Google и других OAuth)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            let location = response.headers.get('location');
            if (location) {
                // Меняем старый Supabase на наш Layero
                location = location.replace('https://rrpcqrvkhmlrdqvffnax.supabase.co', LAYERO_ORIGIN);
                location = location.replace(encodeURIComponent('https://rrpcqrvkhmlrdqvffnax.supabase.co'), encodeURIComponent(LAYERO_ORIGIN));
                res.setHeader('location', location);
            }
        }
        
        const data = await response.text();
        res.send(data);
    } catch (e) {
        console.error('Proxy Error:', e);
        res.status(500).json({ error: 'Proxy error' });
    }
});

// ==========================================
// 3. ЗАПУСК
// ==========================================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
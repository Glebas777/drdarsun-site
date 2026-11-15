const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
        user: process.env.OTPRAVKA_POCHTA,
        pass: process.env.POLUCHIT_POCHTA
    }
});

// В самом начале, после app.use(express.json());
const verificationCodes = {};

app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    verificationCodes[email] = { code, expires: Date.now() + 15 * 60 * 1000 };

    try {
        await transporter.sendMail({
            from: `"Dr. DarSun" <${process.env.OTPRAVKA_POCHTA}>`,
            to: email,
            subject: 'Код подтверждения Dr. DarSun',
            text: `Ваш код: ${code}`,
            html: `<h2>Ваш код: ${code}</h2>`
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка отправки' });
    }
});

app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;
    const record = verificationCodes[email];
    if (!record || record.code !== code || Date.now() > record.expires) {
        return res.status(400).json({ success: false, message: 'Неверный код' });
    }
    delete verificationCodes[email];
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';
const LAYERO_ORIGIN = 'https://drdarsun-site-main.layero.app';

// ==========================================
// 1. КОСТЫЛЬ ДЛЯ ЯНДЕКСА (ПЕРЕХВАТЫВАЕТ ВХОД)
// ==========================================
app.get('/auth/v1/callback', async (req, res) => {
    const { code, provider } = req.query; // provider мы не передаем, но можно определить по referer
    const referer = req.headers.referer || '';
    
    if (!code) return res.redirect('https://drdarsun.ru/login.html?error=no_code');

    try {
        let email = null;
        let name = null;

        // ОПРЕДЕЛЯЕМ ПРОВАЙДЕРА
        if (referer.includes('yandex')) {
            // ЯНДЕКС
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
            if (!tokenData.access_token) throw new Error('No Yandex token');

            const userRes = await fetch('https://login.yandex.ru/info?format=json', {
                headers: { 'Authorization': `OAuth ${tokenData.access_token}` }
            });
            const userData = await userRes.json();
            email = userData.default_email;
            name = userData.real_name || userData.display_name;

        } else if (referer.includes('google')) {
            // GOOGLE
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    client_id: '1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com',
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: 'https://drdarsun-site-main.layero.app/auth/v1/callback'
                })
            });
            const tokenData = await tokenRes.json();
            if (!tokenData.access_token) throw new Error('No Google token');

            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            const userData = await userRes.json();
            email = userData.email;
            name = userData.name;

        } else {
            throw new Error('Unknown provider');
        }

        if (!email) throw new Error('No email');

        // ГЕНЕРИРУЕМ MAGIC LINK
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
                options: { redirect_to: 'https://drdarsun.ru/profile.html' }
            })
        });
        
        const linkData = await linkRes.json();
        
        if (linkData.error || !linkData.hashed_token) {
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
                    user_metadata: { full_name: name }
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
            return res.redirect(`https://drdarsun.ru/auth/confirm?token_hash=${retryData.hashed_token}&type=magiclink`);
        }

        res.redirect(`https://drdarsun.ru/auth/confirm?token_hash=${linkData.hashed_token}&type=magiclink`);

    } catch (e) {
        console.error('Auth Error:', e);
        res.redirect('https://drdarsun.ru/login.html?error=auth_fail');
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
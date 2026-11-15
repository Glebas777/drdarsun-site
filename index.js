const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({
    origin: ['https://drdarsun.ru', 'https://drdarsun-site-main.layero.app'],
    credentials: true
}));
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});
app.disable('x-powered-by');

const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Слишком много запросов, попробуйте позже.' }
});
app.use('/api/', limiter);

const PORT = process.env.PORT || 8080;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';
const LAYERO_ORIGIN = 'https://drdarsun-site-main.layero.app';

const transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
        user: 'drdarsunrecipient@yandex.ru', // Твой адрес (захардкожен)
        pass: process.env.POLUCHIT_POCHTA    // Пароль приложения от него
    }
});

const verificationCodes = {};

app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    verificationCodes[email] = { code, expires: Date.now() + 15 * 60 * 1000 };

    try {
        await transporter.sendMail({
from: `"Dr. DarSun" <drdarsunrecipient@yandex.ru>`,            to: email,
            subject: 'Код подтверждения Dr. DarSun',
            text: `Ваш код: ${code}`,
            html: `<h2>Ваш код: ${code}</h2>`
        });
        res.json({ success: true });
    } catch (e) {
        console.error(e);
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

// --- КОСТЫЛЬ ДЛЯ ЯНДЕКСА И GOOGLE ---
app.get('/auth/v1/callback', async (req, res) => {
    const { code } = req.query;
    const referer = req.headers.referer || '';
    
    if (!code) return res.redirect('https://drdarsun.ru/login.html?error=no_code');

    try {
        let email = null;
        let name = null;
        let tokenRes;

        if (referer.includes('yandex')) {
            tokenRes = await fetch('https://oauth.yandex.ru/token', {
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
            tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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

        // Генерируем Magic Link
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

app.post('/api/gigachat', async (req, res) => {
    try {
        const { message, history } = req.body;

        const productsRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/products?select=name,price,description`, {
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            }
        });
        const products = await productsRes.json();
        const productList = products.map(p => `${p.name} (${p.price} ₽) — ${p.description}`).join('\n');

        const systemPrompt = `Ты — Доктор ДарСан, сыровар. 
        ВОТ ЧТО ЕСТЬ В МАГАЗИНЕ:
        ${productList}
        
        ПРАВИЛА:
        1. Советуй только из списка выше.
        2. Если просят стикер — напиши ТОЛЬКО код: :hello:, :hooray:, :ok:, :oops:, :question:, :eat:.
        3. Отвечай кратко (1-2 предложения).
        4. Если не знаешь — скажи "Не знаю, спросите менеджера".`;

        const zvenoRes = await fetch('https://api.zveno.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ZVENO_API_KEY}` },
            body: JSON.stringify({
                model: 'minimax/minimax-m2.7',
                messages: [{ role: 'system', content: systemPrompt }, ...(history || []), { role: 'user', content: message }],
                max_tokens: 300
            })
        });

        const data = await zvenoRes.json();
        let reply = data.choices?.[0]?.message?.content || 'Ох, старый я стал.';

        res.json({ reply });

    } catch (e) {
        console.error(e);
        res.json({ reply: 'Ошибка сервера.' });
    }
});

// --- ПРОКСИ ДЛЯ ВСЕГО ОСТАЛЬНОГО ---
app.all('*', async (req, res) => {
    try {
        const targetUrl = `${CF_WORKER}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { ...req.headers, host: 'supabase-proxy.turgleb7.workers.dev' },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
            redirect: 'manual'
        });
        
        res.status(response.status);
        response.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'location'].includes(key)) {
                res.setHeader(key, value);
            }
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            let location = response.headers.get('location');
            if (location) {
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
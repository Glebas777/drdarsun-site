const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const nodemailer = require('nodemailer');

const app = express();
app.set('trust proxy', 1);
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

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';
const LAYERO_ORIGIN = 'https://drdarsun-site-main.layero.app';

// --- НАСТРОЙКА ПОЧТЫ ---
// 1. Отправка кодов (с твоей первой почты)
// --- ОТПРАВКА ЧЕРЕЗ RESEND ---
const resendApiKey = process.env.RESEND_API_KEY;

async function sendEmail(to, subject, html) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: 'Dr. DarSun <noreply@drdarsun.ru>', // Пока домен не подтвержден, только этот адрес
            to: [to],
            subject: subject,
            html: html
        })
    });
    return res.json();
}



const verificationCodes = {};

app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    verificationCodes[email] = { code, expires: Date.now() + 15 * 60 * 1000 };

    try {
        const result = await sendEmail(
            email,
            'Код подтверждения Dr. DarSun',
            `<h2>Ваш код: ${code}</h2>`
        );
        
        if (result.error) {
            console.error('Resend Error:', result.error);
            return res.status(500).json({ success: false, message: 'Ошибка отправки', debug: result.error.message });
        }
        
        res.json({ success: true });
    } catch (e) {
        console.error('SMTP Error:', e);
        res.status(500).json({ success: false, message: 'Ошибка отправки', debug: e.message });
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

// --- ЯНДЕКС ---
app.get('/auth/v1/callback/yandex', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('https://drdarsun.ru/login.html?error=no_code');

    try {
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
        const email = userData.default_email;
        const name = userData.real_name || userData.display_name;

        if (!email) throw new Error('No email');

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
        console.error('Yandex Auth Error:', e);
        res.redirect('https://drdarsun.ru/login.html?error=auth_fail');
    }
});

// --- GOOGLE ---
app.get('/auth/v1/callback/google', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('https://drdarsun.ru/login.html?error=no_code');

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: '1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com',
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: 'https://drdarsun-site-main.layero.app/auth/v1/callback/google'
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('No Google token');

        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        const email = userData.email;
        const name = userData.name;

        if (!email) throw new Error('No email');

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
        console.error('Google Auth Error:', e);
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

app.post('/api/register', async (req, res) => {
    const { email, password, name } = req.body;
    try {
        const createRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                password: password,
                email_confirm: true,
                user_metadata: { full_name: name }
            })
        });
        const createData = await createRes.json();
        if (createData.error) throw new Error(createData.error.message);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Введите email' });

    try {
        // 1. Генерируем ссылку для сброса через Admin API
        const linkRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'recovery',
                email: email,
                options: { redirect_to: 'https://drdarsun.ru/reset.html' }
            })
        });
        
        const linkData = await linkRes.json();
        
        if (linkData.error) {
            return res.status(400).json({ success: false, message: linkData.error.message });
        }

        // 2. Отправляем письмо через Resend
        const emailHtml = `
            <h2>Сброс пароля Dr. DarSun</h2>
            <p>Для сброса пароля перейдите по ссылке ниже:</p>
            <a href="${linkData.action_link}" style="display: inline-block; padding: 10px 20px; background: #1B5E20; color: #fff; text-decoration: none; border-radius: 8px;">Сбросить пароль</a>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">Если вы не запрашивали сброс, просто проигнорируйте это письмо.</p>
        `;

        const result = await sendEmail(
            email,
            'Сброс пароля Dr. DarSun',
            emailHtml
        );

        if (result.error) {
            return res.status(500).json({ success: false, message: 'Ошибка отправки', debug: result.error.message });
        }

        res.json({ success: true, message: 'Ссылка для сброса отправлена на почту.' });

    } catch (e) {
        console.error('Reset Password Error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера.' });
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
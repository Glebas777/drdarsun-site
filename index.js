const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
app.use(cors({
    origin: ['https://drdarsun.ru', 'https://drdarsun-site-main.layero.app'],
    credentials: true
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Инициализируем админ-клиент Supabase
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// Настройка почты (Resend)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
async function sendEmail(to, subject, html) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Dr. DarSun <noreply@drdarsun.ru>', to: [to], subject: subject, html: html })
    });
    return res.json();
}

const verificationCodes = {};

// --- ОТПРАВКА КОДА ---
app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    verificationCodes[email] = { code, expires: Date.now() + 15 * 60 * 1000 };

    try {
        const result = await sendEmail(email, 'Код подтверждения Dr. DarSun', `<h2>Ваш код: ${code}</h2>`);
        if (result.error) return res.status(500).json({ success: false, message: 'Ошибка отправки' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ошибка отправки' });
    }
});

// --- ПРОВЕРКА КОДА ---
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
                grant_type: 'authorization_code', code: code,
                client_id: process.env.YANDEX_CLIENT_ID, client_secret: process.env.YANDEX_SECRET_ID
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('No token');

        const userRes = await fetch('https://login.yandex.ru/info?format=json', {
            headers: { 'Authorization': `OAuth ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        const email = userData.default_email;
        const name = userData.real_name || userData.display_name;
        if (!email) throw new Error('No email');

        // Пытаемся сгенерировать ссылку
        let linkData = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: email,
            options: { redirect_to: 'https://drdarsun.ru/profile.html' }
        });

        // Если юзера нет — создаем и генерируем ссылку СРАЗУ
        if (linkData.error || !linkData.data.properties?.hashed_token) {
            await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
            linkData = await supabaseAdmin.auth.admin.generateLink({
                type: 'magiclink', email: email, options: { redirect_to: 'https://drdarsun.ru/profile.html' }
            });
        }

        const tokenHash = linkData.data.properties.hashed_token;
        return res.redirect(`https://drdarsun.ru/auth/confirm?token_hash=${tokenHash}&type=magiclink`);

    } catch (e) {
        console.error(e);
        res.redirect('https://drdarsun.ru/login.html?error=auth_fail');
    }
});

// --- GOOGLE ---
app.get('/auth/v1/callback/google', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('https://drdarsun.ru/login.html?error=no_code');

    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code', code: code,
                client_id: '1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com',
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: 'https://drdarsun-site-main.layero.app/auth/v1/callback/google'
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('No token');

        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        const email = userData.email;
        const name = userData.name;
        if (!email) throw new Error('No email');

        let linkData = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink', email: email, options: { redirect_to: 'https://drdarsun.ru/profile.html' }
        });

        if (linkData.error || !linkData.data.properties?.hashed_token) {
            await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
            linkData = await supabaseAdmin.auth.admin.generateLink({
                type: 'magiclink', email: email, options: { redirect_to: 'https://drdarsun.ru/profile.html' }
            });
        }

        const tokenHash = linkData.data.properties.hashed_token;
        return res.redirect(`https://drdarsun.ru/auth/confirm?token_hash=${tokenHash}&type=magiclink`);

    } catch (e) {
        console.error(e);
        res.redirect('https://drdarsun.ru/login.html?error=auth_fail');
    }
});

// --- РЕГИСТРАЦИЯ ---
app.post('/api/register', async (req, res) => {
    const { email, password, name } = req.body;
    try {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email, password, email_confirm: true, user_metadata: { full_name: name }
        });
        if (error) throw error;
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- СБРОС ПАРОЛЯ ---
app.post('/api/reset-password', async (req, res) => {
    const { email } = req.body;
    try {
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery', email: email, options: { redirect_to: 'https://drdarsun.ru/reset.html' }
        });
        if (error) throw error;
        
        const directLink = `https://drdarsun.ru/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery`;
        const result = await sendEmail(email, 'Сброс пароля Dr. DarSun', `<p>Для сброса пароля перейдите по ссылке: <a href="${directLink}">Сбросить</a></p>`);
        if (result.error) throw new Error('Ошибка отправки');
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- УДАЛЕНИЕ АККАУНТА ---
app.post('/api/delete-account', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No auth' });

    try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'Authorization': authHeader } });
        const user = await userRes.json();
        if (!user.id) throw new Error('User not found');

        const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- ЧАТ С ИИ ---
app.post('/api/gigachat', async (req, res) => {
    try {
        const { message, history, context } = req.body;
        
        let systemPrompt = "Ты — Доктор ДарСан, помощник на сайте. Отвечай кратко.";
        
        if (context === 'catalog') {
            const { data: products } = await supabaseAdmin.from('products').select('*');
            const list = products ? products.map(p => `${p.name} (${p.price} ₽)`).join('\n') : '';
            systemPrompt = `Ты — эксперт по маслам. Вот что есть: \n${list}\nОтвечай кратко.`;
        }

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
        res.json({ reply: data.choices?.[0]?.message?.content || 'Ошибка' });
    } catch (e) {
        res.json({ reply: 'Ошибка сервера' });
    }
});

// --- ПРОКСИ ДЛЯ ВСЕГО ОСТАЛЬНОГО ---
app.all('*', async (req, res) => {
    try {
        const targetUrl = `https://supabase-proxy.turgleb7.workers.dev${req.originalUrl}`;
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
        
        const data = await response.text();
        res.send(data);
    } catch (e) {
        res.status(500).json({ error: 'Proxy error' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { createClient } = require('@supabase/supabase-js'); // <--- ДОБАВЛЕНО

const app = express();
app.set('trust proxy', 1);

// CORS: разрешаем домены и пустой Origin (для curl/мобилок)
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const allowed = ['https://drdarsun.ru', 'https://drdarsun-site-main.layero.app'];
        if (allowed.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
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

// --- SUPABASE ADMIN (для backup-codes и проверок) ---
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ RETRY ---
async function fetchWithRetry(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fetch(url, options);
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// --- НАСТРОЙКА ПОЧТЫ (RESEND) ---
const resendApiKey = process.env.RESEND_API_KEY;
async function sendEmail(to, subject, html) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: 'Dr. DarSun <noreply@drdarsun.ru>',
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
        const result = await sendEmail(email, 'Код подтверждения Dr. DarSun', `<h2>Ваш код: ${code}</h2>`);
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

// --- ОБЩИЙ ОБРАБОТЧИК ДЛЯ ЯНДЕКС/GOOGLE ---
async function handleOAuthCallback(req, res, provider) {
    const { code } = req.query;
    if (!code) return res.redirect('https://drdarsun.ru/login.html?error=no_code');

    try {
        let tokenData, userData, email, name;

        if (provider === 'yandex') {
            const tokenRes = await fetchWithRetry('https://oauth.yandex.ru/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    client_id: process.env.YANDEX_CLIENT_ID,
                    client_secret: process.env.YANDEX_SECRET_ID
                })
            });
            tokenData = await tokenRes.json();
            if (!tokenData.access_token) throw new Error('No Yandex token');

            const userRes = await fetchWithRetry('https://login.yandex.ru/info?format=json', {
                headers: { 'Authorization': `OAuth ${tokenData.access_token}` }
            });
            userData = await userRes.json();
            email = userData.default_email;
            name = userData.real_name || userData.display_name;

        } else if (provider === 'google') {
            const tokenRes = await fetchWithRetry('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    client_id: '1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com',
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: 'https://drdarsun-site-main.layero.app/auth/v1/callback/google'
                })
            });
            tokenData = await tokenRes.json();
            if (!tokenData.access_token) throw new Error('No Google token');

            const userRes = await fetchWithRetry('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            userData = await userRes.json();
            email = userData.email;
            name = userData.name;
        }

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

        let actionLink = linkData.action_link;
        if (actionLink) {
            actionLink = actionLink.replace('https://rrpcqrvkhmlrdqvffnax.supabase.co', 'https://drdarsun-site-main.layero.app');
            return res.redirect(actionLink);
        }

        if (linkData.error || !linkData.hashed_token) {
            await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
                method: 'POST',
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: name } })
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
        console.error(`${provider} Auth Error:`, e);
        res.redirect('https://drdarsun.ru/login.html?error=auth_fail');
    }
}

app.get('/auth/v1/callback/yandex', (req, res) => handleOAuthCallback(req, res, 'yandex'));
app.get('/auth/v1/callback/google', (req, res) => handleOAuthCallback(req, res, 'google'));

app.post('/api/verify-backup-code', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Введите код' });

    try {
        const { data: foundCode, error } = await supabaseAdmin
            .from('backup_codes')
            .select('*')
            .eq('code', code)
            .eq('is_used', false)
            .single();

        if (error || !foundCode) {
            return res.status(400).json({ success: false, message: 'Неверный или использованный код' });
        }

        await supabaseAdmin.from('backup_codes').update({ is_used: true }).eq('id', foundCode.id);

        const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(foundCode.user_id);
        if (!user) return res.status(400).json({ success: false, message: 'Пользователь не найден' });

        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: user.email,
            options: { redirect_to: 'https://drdarsun.ru/profile.html' }
        });

        res.json({ success: true, access_token: linkData.properties.access_token, refresh_token: linkData.properties.refresh_token });
    } catch (e) {
        console.error('Backup Code Error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/gigachat', async (req, res) => {
    try {
        const { message, history, context } = req.body;

        // 1. Получаем список товаров (для контекста "catalog" и "help")
        let productList = '';
        try {
            const productsRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/products?select=name,price,description`, {
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
                }
            });
            const products = await productsRes.json();
            productList = Array.isArray(products) 
                ? products.map(p => `${p.name} (${p.price} ₽) — ${p.description}`).join('\n')
                : '';
        } catch (e) {
            console.error('Products fetch error:', e);
        }

        // 2. Выбираем промпт
        let systemPrompt = '';

        if (context === 'help') {
            systemPrompt = `Ты — Доктор ДарСан, помощник на главной странице сайта. 
            Твоя задача — помогать пользователям с сайтом.
            
            ВОТ ЧТО ТЫ ДОЛЖЕН ЗНАТЬ:
            1. Регистрация: нажми "Войти" -> "Регистрация". Введи имя, email, пароль. Подтверди почту кодом.
            2. Вход: нажми "Войти". Можно через Яндекс, Google или Email/Пароль.
            3. Восстановление пароля: нажми "Забыли пароль?" на странице входа. Введи email, получи ссылку.
            4. Корзина: нажми на иконку корзины в хедере.
            5. Оплата: пока недоступна, но скоро будет.

            ПРАВИЛА:
            - Отвечай кратко (1-2 предложения).
            - Если спрашивают про масло — скажи "Перейдите в Каталог, там я расскажу подробнее".
            - Если просят стикер — напиши ТОЛЬКО код: :hello:, :hooray:, :ok:, :oops:, :question:, :eat:.
            - Не выдумывай факты.`;

        } else if (context === 'catalog') {
            systemPrompt = `Ты — Доктор ДарСан, эксперт по маслам.
            Твоя задача — советовать масла из каталога.
            
            ВОТ ЧТО ЕСТЬ В МАГАЗИНЕ:
            ${productList}
            
            ПРАВИЛА:
            - Советуй только из списка выше.
            - Если просят стикер — напиши ТОЛЬКО код: :hello:, :hooray:, :ok:, :oops:, :question:, :eat:.
            - Отвечай кратко (1-2 предложения).
            - Если не знаешь — скажи "Не знаю, спросите менеджера".`;

        } else {
            systemPrompt = `Ты — Доктор ДарСан, дружелюбный помощник. Отвечай кратко.`;
        }

        // 3. Отправляем в ZvenoAI
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
        // Проверка занятости почты
        const checkRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            }
        });
        const checkData = await checkRes.json();
        if (checkData.users && checkData.users.length > 0) {
            return res.status(400).json({ success: false, message: 'Эта почта уже зарегистрирована. Войдите или восстановите пароль.' });
        }

        const createRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } })
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
        if (linkData.error) return res.status(400).json({ success: false, message: linkData.error.message });

        const directLink = `https://drdarsun.ru/auth/confirm?token_hash=${linkData.hashed_token}&type=recovery`;

        const emailHtml = `
            <h2>Сброс пароля Dr. DarSun</h2>
            <p>Для сброса пароля перейдите по ссылке ниже:</p>
            <a href="${directLink}" style="display: inline-block; padding: 10px 20px; background: #D4AF37; color: #000; text-decoration: none; border-radius: 8px;">Сбросить пароль</a>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">Если вы не запрашивали сброс, просто проигнорируйте это письмо.</p>
        `;

        const result = await sendEmail(email, 'Сброс пароля Dr. DarSun', emailHtml);
        if (result.error) return res.status(500).json({ success: false, message: 'Ошибка отправки', debug: result.error.message });

        res.json({ success: true, message: 'Ссылка для сброса отправлена на почту.' });
    } catch (e) {
        console.error('Reset Password Error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера.' });
    }
});

app.post('/api/logout-others', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No auth' });

    try {
        await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout?scope=others`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/logout-all', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No auth' });

    try {
        await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout?scope=global`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/delete-account', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No auth' });

    try {
        const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
            headers: { 
                'apikey': process.env.SUPABASE_ANON_KEY,
                'Authorization': authHeader 
            }
        });
        const user = await userRes.json();
        if (!user.id) throw new Error('User not found');

        const delRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
            method: 'DELETE',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            }
        });
        
        if (!delRes.ok) throw new Error('Delete failed');
        res.json({ success: true });
    } catch (e) {
        console.error('Delete Account Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/change-email', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No auth' });

    try {
        const { newEmail } = req.body;

        // Проверка занятости новой почты
        const checkRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(newEmail)}`, {
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            }
        });
        const checkData = await checkRes.json();
        if (checkData.users && checkData.users.length > 0) {
            return res.status(400).json({ error: 'Эта почта уже занята другим аккаунтом.' });
        }

        const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
            method: 'PUT',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email: newEmail })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        res.json({ success: true, message: 'Проверьте обе почты для подтверждения.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
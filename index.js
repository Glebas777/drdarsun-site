const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';
const SUPABASE_ORIGIN = 'https://rrpcqrvkhmlrdqvffnax.supabase.co';
const LAYERO_ORIGIN = 'https://drdarsun-site-main.layero.app';

// Настройка почты
const transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
        user: process.env.OTPRAVKA_POCHTA,
        pass: process.env.POLUCHIT_POCHTA
    }
});

const verificationCodes = {}; 

// 1. Отправка кода
app.post('/api/send-code', async (req, res) => {
    const { email, method } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    verificationCodes[email] = { code, expires: Date.now() + 15 * 60 * 1000 };

    if (method === 'email') {
        try {
            await transporter.sendMail({
                from: `"Dr. DarSun" <${process.env.OTPRAVKA_POCHTA}>`,
                to: email,
                subject: 'Код подтверждения Dr. DarSun',
                text: `Ваш код: ${code}`,
                html: `<h2>Ваш код: ${code}</h2>`
            });
            res.json({ success: true, message: 'Код отправлен' });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Ошибка отправки' });
        }
    } else {
        console.log(`Код для ТГ (${email}): ${code}`);
        res.json({ success: true });
    }
});

// 2. Проверка кода
app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;
    const record = verificationCodes[email];
    if (!record || record.code !== code || Date.now() > record.expires) {
        return res.status(400).json({ success: false, message: 'Неверный код' });
    }
    delete verificationCodes[email]; 
    res.json({ success: true });
});

// 3. Прокси для Supabase и OAuth
app.all('*', async (req, res) => {
    try {
        const targetUrl = `${CF_WORKER}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { ...req.headers, host: new URL(CF_WORKER).host },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
            redirect: 'manual'
        });
        
        // --- ПЕРЕПИСЫВАНИЕ РЕДИРЕКТОВ (МАГИЯ) ---
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            let location = response.headers.get('location');
            if (location) {
                // 1. Меняем обычный домен
                location = location.replace(SUPABASE_ORIGIN, LAYERO_ORIGIN);
                // 2. Меняем ЗАКОДИРОВАННЫЙ redirect_uri (для Яндекса и Google)
                location = location.replace(encodeURIComponent(SUPABASE_ORIGIN), encodeURIComponent(LAYERO_ORIGIN));
                // 3. Меняем домен воркера (на всякий случай)
                location = location.replace('https://supabase-proxy.turgleb7.workers.dev', LAYERO_ORIGIN);
                location = location.replace(encodeURIComponent('https://supabase-proxy.turgleb7.workers.dev'), encodeURIComponent(LAYERO_ORIGIN));

                res.setHeader('location', location);
            }
        }

        res.status(response.status);
        response.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
                res.setHeader(key, value);
            }
        });
        const data = await response.text();
        res.send(data);
    } catch (e) {
        console.error('Proxy Error:', e);
        res.status(500).json({ error: 'Proxy error' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
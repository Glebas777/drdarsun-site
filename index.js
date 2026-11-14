const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';

// Хранилище кодов в памяти (для продакшена лучше БД, но для теста сойдет)
const verificationCodes = {}; 

// 1. Отправка кода
app.post('/api/send-code', async (req, res) => {
    const { email, phone, method } = req.body; // method: 'email' или 'telegram'
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    
    // Сохраняем код
    const key = email || phone;
    verificationCodes[key] = { code, expires: Date.now() + 15 * 60 * 1000 }; // 15 минут

    if (method === 'email') {
        // Тут логика отправки на почту (через Resend или SMTP)
        console.log(`Отправка на почту ${email}: ${code}`);
    } else if (method === 'telegram') {
        // Тут логика отправки в ТГ (через Gateway или своего бота)
        console.log(`Отправка в ТГ ${phone}: ${code}`);
    }
    
    res.json({ success: true, message: 'Код отправлен' });
});

// 2. Проверка кода
app.post('/api/verify-code', (req, res) => {
    const { email, phone, code } = req.body;
    const key = email || phone;
    const record = verificationCodes[key];

    if (!record || record.code !== code || Date.now() > record.expires) {
        return res.status(400).json({ success: false, message: 'Неверный или просроченный код' });
    }

    delete verificationCodes[key]; // Код одноразовый
    res.json({ success: true });
});

// Прокси для остального (как было)
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
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
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
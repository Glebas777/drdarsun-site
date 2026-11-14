const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';

// Настройка почты (используем OTPRAVKA_POCHTA и пароль приложения)
const transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
        user: process.env.OTPRAVKA_POCHTA, // Твоя почта ДЛЯ ОТПРАВКИ
        pass: process.env.POLUCHIT_POCHTA  // Пароль приложения (код из букв)
    }
});

const verificationCodes = {}; 

// 1. Отправка кода
app.post('/api/send-code', async (req, res) => {
    const { email, method } = req.body;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    
    // Сохраняем код (привязываем к email, на который должны прийти данные)
    verificationCodes[email] = { code, expires: Date.now() + 15 * 60 * 1000 };

    if (method === 'email') {
        try {
            // ВАЖНО: В поле 'to' ставим email клиента, который он ввел при регистрации
            await transporter.sendMail({
                from: `"Dr. DarSun" <${process.env.OTPRAVKA_POCHTA}>`, // От кого
                to: email, // Кому (клиент)
                subject: 'Код подтверждения Dr. DarSun',
                text: `Ваш код подтверждения: ${code}`,
                html: `<h2>Ваш код: ${code}</h2><p>Введите его на сайте.</p>`
            });
            res.json({ success: true, message: 'Код отправлен' });
        } catch (e) {
            console.error('Ошибка почты:', e);
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

// Прокси для Supabase
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
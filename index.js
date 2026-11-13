const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- ЧАТ С ИИ (через Layero) ---
app.post('/api/gigachat', async (req, res) => {
    try {
        const response = await fetch('https://supabase-proxy.turgleb7.workers.dev/api/gigachat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.json({ reply: 'Ошибка сервера Layero.' });
    }
});

// --- ПОДДЕРЖКА ---
app.post('/api/support', async (req, res) => {
    try {
        const response = await fetch('https://supabase-proxy.turgleb7.workers.dev/api/support', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.json({ success: false });
    }
});

// --- ПРОКСИ ДЛЯ OAuth (Яндекс, Google, Telegram) ---
// Это перенаправит запросы входа через твой Cloudflare Worker
app.get('/auth/v1/*', (req, res) => {
    const targetUrl = `https://supabase-proxy.turgleb7.workers.dev/auth/v1/${req.params[0] || ''}${req._parsedUrl.search || ''}`;
    res.redirect(targetUrl);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
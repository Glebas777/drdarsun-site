const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';

// Универсальный прокси для ВСЕГО (включая /auth/v1/authorize)
app.all('*', async (req, res) => {
    try {
        const targetUrl = `${CF_WORKER}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { 
                ...req.headers, 
                host: 'supabase-proxy.turgleb7.workers.dev',
                // Важно: передаем заголовки как есть
            },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
            redirect: 'manual' // Перехватываем редиректы
        });
        
        // Копируем заголовки ответа
        res.status(response.status);
        response.headers.forEach((value, key) => {
            // Не копируем некоторые заголовки
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
                res.setHeader(key, value);
            }
        });
        
        const data = await response.text();
        res.send(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Proxy error' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
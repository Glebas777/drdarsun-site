const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';

app.all('*', async (req, res) => {
    try {
        const targetUrl = `${CF_WORKER}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { ...req.headers, host: 'supabase-proxy.turgleb7.workers.dev' },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
            redirect: 'manual'
        });
        
        // Копируем статус
        res.status(response.status);
        
        // Копируем заголовки
        response.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
                if (key === 'location') {
                    // ЖЕСТКО ПЕРЕПИСЫВАЕМ LOCATION
                    const newLocation = value.replace('https://rrpcqrvkhmlrdqvffnax.supabase.co', `https://${req.headers.host}`);
                    res.setHeader(key, newLocation);
                } else {
                    res.setHeader(key, value);
                }
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
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CF_WORKER = 'https://supabase-proxy.turgleb7.workers.dev';
const SUPABASE_ORIGIN = 'https://rrpcqrvkhmlrdqvffnax.supabase.co';
const LAYERO_ORIGIN = 'https://drdarsun-site-main.layero.app';

app.all('*', async (req, res) => {
    try {
        const targetUrl = `${CF_WORKER}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { 
                ...req.headers, 
                host: 'supabase-proxy.turgleb7.workers.dev',
                'Cache-Control': 'no-cache' // Говорим Cloudflare не кэшировать
            },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
            redirect: 'manual'
        });
        
        // Копируем заголовки, но не трогаем location
        const headersToSkip = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'location'];
        res.status(response.status);
        response.headers.forEach((value, key) => {
            if (!headersToSkip.includes(key)) {
                res.setHeader(key, value);
            }
        });

        // ПЕРЕПИСЫВАЕМ LOCATION (жестко)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            let location = response.headers.get('location');
            if (location) {
                // 1. Меняем обычный URL
                location = location.replace(SUPABASE_ORIGIN, LAYERO_ORIGIN);
                // 2. Меняем закодированный URL (для OAuth)
                location = location.replace(encodeURIComponent(SUPABASE_ORIGIN), encodeURIComponent(LAYERO_ORIGIN));
                // 3. На всякий случай меняем воркер
                location = location.replace('https://supabase-proxy.turgleb7.workers.dev', LAYERO_ORIGIN);
                
                res.setHeader('location', location);
            }
        }
        
        const data = await response.text();
        res.send(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Proxy error' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
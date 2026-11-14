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

        // Копируем заголовки, но НЕ трогаем location
        response.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'location'].includes(key)) {
                res.setHeader(key, value);
            }
        });

        // Переписываем редирект ПОСЛЕ того, как скопировали все заголовки
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (location) {
                const newLocation = location.replace('https://rrpcqrvkhmlrdqvffnax.supabase.co', 'https://drdarsun-site-main.layero.app');
                res.setHeader('location', newLocation);
            }
        }
        
        const data = await response.text();
        res.send(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Proxy error' });
    }
});
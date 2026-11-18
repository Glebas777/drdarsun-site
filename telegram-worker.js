const express = require('express');
const { startTelegramBots } = require('./telegram-bots');
const createTelegramIntegrationRouter = require('./telegram-integration');

const requiredEnvironment = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvironment = requiredEnvironment.filter(name => !process.env[name]);

if (missingEnvironment.length) {
    console.error(`Telegram worker is missing required environment variables: ${missingEnvironment.join(', ')}`);
    process.exitCode = 1;
} else {
    const app = express();
    app.use(express.json({ limit: '32kb' }));
    app.use('/api/telegram', createTelegramIntegrationRouter());

    const server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
            console.error('Telegram worker failed to bind its internal API.');
            process.exitCode = 1;
            server.close();
            return;
        }

        const workerEnv = {
            ...process.env,
            BOT_API_BASE_URL: `http://127.0.0.1:${address.port}`
        };
        const bots = startTelegramBots({ env: workerEnv });
        if (!bots.roles.length) {
            console.error('Telegram worker did not start: no valid bot tokens or required owner chat IDs are configured.');
            process.exitCode = 1;
            server.close();
            return;
        }

        console.log(`Dedicated Telegram worker started: ${bots.roles.join(', ')}`);
        const stop = () => {
            console.log('Stopping dedicated Telegram worker.');
            bots.stop();
            server.close();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    });

    server.on('error', error => {
        console.error('Dedicated Telegram worker internal API failed:', error.message);
        process.exitCode = 1;
    });
}

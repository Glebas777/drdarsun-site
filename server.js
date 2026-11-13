const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Берем ключи из переменных окружения Layero
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CODE_BOT_TOKEN = process.env.CODE_BOT_TOKEN; 

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 1. ВЕБХУК ДЛЯ БОТА (принимает команду /start с кодом)
app.post('/webhook', async (req, res) => {
    const { message } = req.body;
    if (!message || !message.text) return res.sendStatus(200);

    const text = message.text;
    const tgId = message.from.id.toString();
    const tgUsername = message.from.username || 'no_username';

    if (text.startsWith('/start ')) {
        const code = text.split(' ')[1];

        // Ищем код в базе
        const { data: links } = await supabase
            .from('telegram_links')
            .select('*')
            .eq('link_code', code)
            .eq('is_verified', false);

        if (links && links.length > 0) {
            await supabase.from('telegram_links')
                .update({ 
                    telegram_id: tgId, 
                    telegram_username: tgUsername, 
                    is_verified: true,
                    link_code: null 
                })
                .eq('id', links[0].id);

            await fetch(`https://api.telegram.org/bot${CODE_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: tgId,
                    text: '✅ Аккаунт привязан! Теперь коды безопасности будут приходить сюда.'
                })
            });
        } else {
            await fetch(`https://api.telegram.org/bot${CODE_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: tgId,
                    text: '❌ Код не найден или уже использован.'
                })
            });
        }
    }
    res.sendStatus(200);
});

// 2. ОТПРАВКА КОДА (вызывается с сайта при входе)
app.post('/send-code', async (req, res) => {
    const { userId, code } = req.body;

    // Ищем Telegram ID юзера
    const { data: link } = await supabase
        .from('telegram_links')
        .select('telegram_id')
        .eq('user_id', userId)
        .eq('is_verified', true)
        .single();

    if (link && link.telegram_id) {
        await fetch(`https://api.telegram.org/bot${CODE_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: link.telegram_id,
                text: `🔐 Ваш код подтверждения: <b>${code}</b>\n\nНикому не сообщайте этот код.`,
                parse_mode: 'HTML'
            })
        });
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Telegram не привязан' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
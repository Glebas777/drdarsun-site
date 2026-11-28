const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
    path.join(__dirname, '../database/telegram-account-auth.sql'),
    'utf8'
);

test('Telegram migration safely normalizes existing bigint chat IDs to text', () => {
    for (const table of [
        'telegram_accounts',
        'telegram_link_requests',
        'telegram_login_requests'
    ]) {
        assert.match(
            migration,
            new RegExp(`alter table public\\.${table}\\s+alter column telegram_chat_id type text using telegram_chat_id::text`, 'i')
        );
    }
});

test('Telegram link confirmation fills the legacy required email column', () => {
    assert.match(migration, /add column if not exists email text/i);
    assert.match(
        migration,
        /insert into public\.telegram_accounts\s*\(\s*user_id,\s*email,\s*telegram_chat_id/i
    );
    assert.match(
        migration,
        /values\s*\(\s*link_request\.user_id,\s*link_request\.email,\s*p_telegram_chat_id/i
    );
});

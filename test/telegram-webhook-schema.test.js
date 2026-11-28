const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../database/telegram-webhook-status.sql'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../database/complete-current-schema.sql'), 'utf8');

test('Telegram webhook status constraint permits the claim function processing state', () => {
    const allowedStatuses = /check\s*\(\s*status\s+in\s*\(\s*'pending'\s*,\s*'processing'\s*,\s*'completed'\s*\)\s*\)/i;
    assert.match(migration, allowedStatuses);
    assert.match(schema, allowedStatuses);
    assert.match(schema, /set\s+status\s*=\s*'processing'/i);
});

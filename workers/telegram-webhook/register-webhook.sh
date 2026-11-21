#!/usr/bin/env bash
set -euo pipefail

role="admin"

if [[ ! -t 0 ]]; then
    echo "Запусти команду в обычном терминале, чтобы ввести секрет." >&2
    exit 2
fi

host="drdarsun-tg-a.turgleb7.workers.dev"
url="https://${host}"
secret=""

cleanup() {
    unset secret
}
trap cleanup EXIT

printf 'Вводи WEBHOOK_ADMIN_SECRET именно Worker-а: %s\n' "$role"
read -r -s -p "Вставь секрет и нажми Enter (ввод скрыт): " secret </dev/tty
printf '\nСекрет принят. Проверяю health Worker-а %s...\n' "$role"

auth_config="$(mktemp)"
response_file="$(mktemp)"
trap 'cleanup; rm -f "$auth_config" "$response_file"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$secret" > "$auth_config"
chmod 600 "$auth_config"
unset secret

if ! health_status="$(curl -sS --max-time 20 --config "$auth_config" \
    -o "$response_file" -w '%{http_code}' "$url/admin/health")"; then
    echo "Не удалось связаться с Worker-ом. Проверь интернет и повтори команду." >&2
    exit 1
fi

if [[ "$health_status" != "200" ]] || ! node -e '
    let body = "";
    process.stdin.on("data", chunk => body += chunk);
    process.stdin.on("end", () => {
        try {
            if (JSON.parse(body).ok !== true) process.exitCode = 1;
        } catch {
            process.exitCode = 1;
        }
    });
' < "$response_file"; then
    echo "Health не прошёл (HTTP $health_status). Webhook не регистрировал." >&2
    cat "$response_file" >&2
    exit 1
fi

echo "Health OK. Регистрирую webhook бота $role..."
if ! register_status="$(curl -sS --max-time 20 --config "$auth_config" \
    -X POST -o "$response_file" -w '%{http_code}' "$url/admin/register")"; then
    echo "Не удалось связаться с Worker-ом при регистрации. Повтори команду." >&2
    exit 1
fi

if [[ "$register_status" != "200" ]] || ! node -e '
    const role = process.argv[1];
    let body = "";
    process.stdin.on("data", chunk => body += chunk);
    process.stdin.on("end", () => {
        try {
            const result = JSON.parse(body);
            if (result.action !== "register" ||
                result.results?.length !== 1 ||
                result.results[0].role !== role ||
                result.results[0].success !== true) {
                process.exitCode = 1;
            }
        } catch {
            process.exitCode = 1;
        }
    });
' "$role" < "$response_file"; then
    echo "Регистрация не подтверждена (HTTP $register_status):" >&2
    cat "$response_file" >&2
    exit 1
fi

cat "$response_file"
echo
echo "Готово: webhook бота $role зарегистрирован."

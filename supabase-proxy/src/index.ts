export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ==========================================
    // 1. ЛОГИКА ДЛЯ API (ИИ, ОТЗЫВЫ, АВТОРИЗАЦИЯ)
    // ==========================================
    if (path.startsWith('/api/')) {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // Разрешаем всем (для локалки и прода)
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const json = (data: any, status = 200) => new Response(JSON.stringify(data), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

      // --- ХЕШИРОВАНИЕ ДЛЯ КОДОВ ---
      const hashCode = async (code: string, salt: string) => {
        const data = new TextEncoder().encode(code + salt);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      };

      // --- ЧАТ С ИИ ---
      if (path === '/api/gigachat' && request.method === 'POST') {
        try {
          const { message, history } = await request.json();
          if (!message || message.length > 1000) return json({ reply: 'Слишком длинное сообщение.' }, 400);

          const recentHistory = (history || []).slice(-4).map((msg: any) => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: String(msg.text || '').trim() || '...'
          }));

          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [
              { role: 'system', content: 'Ты — Доктор ДарСан. Отвечай кратко.' },
              ...recentHistory,
              { role: 'user', content: String(message).trim() }
            ],
            max_tokens: 300
          });

          return json({ reply: aiResponse.response || 'Ошибка ИИ.' });
        } catch (e: any) {
          return json({ reply: 'Ошибка: ' + e.message }, 500);
        }
      }

      // --- СОХРАНЕНИЕ ОТЗЫВА (НА МОДЕРАЦИЮ) ---
      if (path === '/api/review' && request.method === 'POST') {
        try {
          const { user_id, name, rating, page_number, text } = await request.json();
          
          if (!text || text.length < 5) return json({ error: 'Текст слишком короткий' }, 400);
          if (text.length > 500) return json({ error: 'Слишком длинный отзыв' }, 400);

          const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/reviews`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ 
              user_id: user_id || null, 
              name: name || 'Аноним',
              rating: rating || 5,
              page_number: page_number || 1, 
              text, 
              status: 'pending' 
            })
          });

          if (!sbRes.ok) throw new Error('Ошибка Supabase');
          
          if (env.ADMIN_BOT_TOKEN && env.MY_CHAT_ID && ctx) {
              ctx.waitUntil(fetch(`https://api.telegram.org/bot${env.ADMIN_BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      chat_id: env.MY_CHAT_ID,
                      text: `📝 <b>Новый отзыв на модерацию!</b>\n\n👤 Имя: ${name || 'Аноним'}\n⭐ Оценка: ${rating || 5}\n💬 Текст: ${text}`,
                      parse_mode: 'HTML'
                  })
              }));
          }

          return json({ success: true });

        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      }

      // --- ПОЛУЧЕНИЕ ОТЗЫВОВ (С КЭШЕМ) ---
      if (path === '/api/reviews' && request.method === 'GET') {
        try {
          if (env.CACHE) {
            const cached = await env.CACHE.get('reviews:all');
            if (cached) return new Response(cached, { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' } });
          }

          const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/reviews?select=*&status=eq.approved`, {
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });
          const reviews = await sbRes.json();
          const reviewsText = JSON.stringify(reviews);

          if (env.CACHE) await env.CACHE.put('reviews:all', reviewsText, { expirationTtl: 60 });

          return json(reviews);
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      } 

      // --- УСТАНОВКА РЕЗЕРВНОГО КОДА ---
      if (path === '/api/auth/set-backup-code' && request.method === 'POST') {
        try {
          const authHeader = request.headers.get('Authorization');
          if (!authHeader) return json({ error: 'Нет токена' }, 401);
          
          const { code } = await request.json();
          if (!code || code.length < 6) return json({ error: 'Короткий код' }, 400);

          const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
            headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY }
          });
          if (!userRes.ok) return json({ error: 'Неверный токен' }, 401);
          const user = await userRes.json();

          const salt = crypto.randomUUID().replace(/-/g, '');
          const hash = await hashCode(code, salt);

          await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ backup_code_hash: hash, backup_code_salt: salt })
          });

          return json({ success: true });
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      }

      // --- ВХОД ПО РЕЗЕРВНОМУ КОДУ ---
      if (path === '/api/auth/backup-login' && request.method === 'POST') {
        try {
          const { email, code } = await request.json();
          
          const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
            headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
          });
          const users = await userRes.json();
          if (!users || users.length === 0) return json({ error: 'Пользователь не найден' }, 404);
          
          const user = users[0];
          const profileRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=backup_code_hash,backup_code_salt`, {
            headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
          });
          const profiles = await profileRes.json();
          
          if (!profiles || profiles.length === 0 || !profiles[0].backup_code_hash) {
            return json({ error: 'Код не установлен' }, 400);
          }

          const { backup_code_hash, backup_code_salt } = profiles[0];
          const inputHash = await hashCode(code, backup_code_salt);

          if (inputHash !== backup_code_hash) return json({ error: 'Неверный код' }, 401);

          const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
            method: 'POST',
            headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'magiclink', email: email })
          });
          
          const linkData = await linkRes.json();
          if (linkData.action_link) return json({ action_link: linkData.action_link });

          return json({ error: 'Ошибка генерации' }, 500);
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      }

      return json({ error: 'Not Found' }, 404);
    }

    // ==========================================
    // 2. ЛОГИКА ДЛЯ ПРОКСИ SUPABASE (OAUTH)
    // ==========================================
    const SUPABASE_URL = env.SUPABASE_URL;
    const PROXY_URL = `https://${url.host}`;
    const targetUrl = new URL(SUPABASE_URL + url.pathname + url.search);

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', new URL(SUPABASE_URL).host);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': '*' },
      });
    }

    const newRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'manual',
    });

    const response = await fetch(newRequest);
    
    const contentType = response.headers.get('content-type') || '';
    const isText = contentType.includes('text/') || contentType.includes('json') || contentType.includes('html');

    if (isText) {
      let text = await response.text();
      if (text.includes(SUPABASE_URL)) {
        text = text.split(SUPABASE_URL).join(PROXY_URL);
        const encodedSupabase = encodeURIComponent(SUPABASE_URL);
        const encodedProxy = encodeURIComponent(PROXY_URL);
        text = text.split(encodedSupabase).join(encodedProxy);
      }

      const outHeaders = new Headers(response.headers);
      outHeaders.delete('content-length');
      outHeaders.set('Access-Control-Allow-Origin', '*');
      outHeaders.set('Access-Control-Allow-Credentials', 'true');

      if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('Location');
          if (location) outHeaders.set('Location', location.split(SUPABASE_URL).join(PROXY_URL));
      }

      return new Response(text, { status: response.status, statusText: response.statusText, headers: outHeaders });
    }

    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Credentials', 'true');

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (location) newResponse.headers.set('Location', location.split(SUPABASE_URL).join(PROXY_URL));
    }

    return newResponse;
  },
};
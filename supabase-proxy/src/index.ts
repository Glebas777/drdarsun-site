export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ==========================================
    // 1. ЛОГИКА ДЛЯ ИИ И ОТЗЫВОВ (API)
    // ==========================================
    if (path.startsWith('/api/')) {
      // CORS
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const json = (data, status = 200) => new Response(JSON.stringify(data), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

      // --- ЧАТ С ИИ ---
      if (path === '/api/gigachat' && request.method === 'POST') {
        try {
          const { message, history } = await request.json();
          if (!message || message.length > 1000) return json({ reply: 'Слишком длинное сообщение.' }, 400);

          const recentHistory = (history || []).slice(-4).map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: String(msg.text || '').trim() || '...'
          }));

          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              { role: 'system', content: 'Ты — Доктор ДарСан. Отвечай кратко, вежливо, с заботой о клиенте.' },
              ...recentHistory,
              { role: 'user', content: String(message).trim() }
            ],
            max_tokens: 300
          });

          return json({ reply: aiResponse.response || 'Ошибка ИИ.' });
        } catch (e) {
          return json({ reply: 'Ошибка: ' + e.message }, 500);
        }
      }

      // --- СОХРАНЕНИЕ ОТЗЫВА ---
      if (path === '/api/review' && request.method === 'POST') {
        try {
          const { user_id, page_number, text } = await request.json();
          if (!user_id || !page_number || !text) return json({ error: 'Не все поля' }, 400);
          if (text.length > 100) return json({ error: 'Слишком длинный отзыв' }, 400);

          const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/reviews`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_id, page_number, text, status: 'pending' })
          });

          if (!sbRes.ok) throw new Error('Ошибка Supabase');
          
          if (env.ADMIN_BOT_TOKEN && env.MY_CHAT_ID && ctx) {
              ctx.waitUntil(fetch(`https://api.telegram.org/bot${env.ADMIN_BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      chat_id: env.MY_CHAT_ID,
                      text: `📝 <b>Новый отзыв на модерацию!</b>\n\n👤 ID: ${user_id.substring(0,8)}...\n📄 Страница: ${page_number}\n💬 Текст: ${text}`,
                      parse_mode: 'HTML'
                  })
              }));
          }

          return json({ success: true });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }

      // --- ПОЛУЧЕНИЕ ОТЗЫВОВ ---
      if (path === '/api/reviews' && request.method === 'GET') {
        try {
          const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/reviews?select=*&status=eq.approved`, {
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });
          const reviews = await sbRes.json();
          return json(reviews);
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }

      return json({ error: 'Not Found' }, 404);
    }

    // ==========================================
    // 2. ЛОГИКА ДЛЯ ПРОКСИ SUPABASE (OAUTH)
    // ==========================================
    const SUPABASE_URL = 'https://rrpcqrvkhmlrdqvffnax.supabase.co';
    const PROXY_URL = `https://${url.host}`;
    const targetUrl = new URL(SUPABASE_URL + url.pathname + url.search);

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', new URL(SUPABASE_URL).host);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
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
      text = text.split(SUPABASE_URL).join(PROXY_URL);
      const encodedSupabase = encodeURIComponent(SUPABASE_URL);
      const encodedProxy = encodeURIComponent(PROXY_URL);
      text = text.split(encodedSupabase).join(encodedProxy);

      const outHeaders = new Headers(response.headers);
      outHeaders.delete('content-length');
      outHeaders.set('Access-Control-Allow-Origin', '*');
      outHeaders.set('Access-Control-Allow-Credentials', 'true');

      if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('Location');
          if (location) {
              outHeaders.set('Location', location.split(SUPABASE_URL).join(PROXY_URL));
          }
      }

      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      });
    }

    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Credentials', 'true');

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (location) {
        newResponse.headers.set('Location', location.split(SUPABASE_URL).join(PROXY_URL));
      }
    }

    return newResponse;
  },
};
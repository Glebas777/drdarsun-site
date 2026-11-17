import { supabase } from './supabase-client.js';

const container = document.getElementById('auth-buttons');

function renderHeader(session) {
    if (!container) return;
    container.replaceChildren();

    const link = document.createElement('a');
    link.className = 'header__btn';
    link.href = session ? 'profile.html' : 'login.html';
    link.textContent = session ? 'Профиль' : 'Войти';
    container.appendChild(link);
}

async function checkDeviceAlive() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        console.warn('Device session lookup failed:', sessionError);
        return;
    }
    if (!session) return;

    let deviceKey;
    try {
        deviceKey = localStorage.getItem('device_key');
    } catch (error) {
        console.warn('Device key is unavailable:', error);
        return;
    }
    if (!deviceKey) return;

    const { data, error } = await supabase
        .from('devices')
        .select('device_key')
        .eq('user_id', session.user.id)
        .eq('device_key', deviceKey)
        .maybeSingle();

    if (error) {
        console.warn('Device check failed:', error);
        return;
    }
    if (!data) {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    }
}

if (container) {
    let hadSession = false;
    supabase.auth.getSession().then(({ data, error }) => {
        if (error) console.error('Header session lookup failed:', error);
        hadSession = Boolean(data?.session);
        renderHeader(data?.session || null);
        if (data?.session) checkDeviceAlive();
    }).catch(error => {
        console.error('Header session lookup failed:', error);
        renderHeader(null);
    });

    supabase.auth.onAuthStateChange((event, session) => {
        renderHeader(session);
        const shouldRedirectAfterSignOut = event === 'SIGNED_OUT' && hadSession;
        hadSession = Boolean(session);
        if (event === 'SIGNED_IN') checkDeviceAlive();
        if (
            shouldRedirectAfterSignOut &&
            !window.location.pathname.includes('login.html') &&
            !window.location.pathname.includes('register.html')
        ) {
            window.location.href = 'index.html';
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkDeviceAlive();
    });
}
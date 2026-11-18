import { supabase } from './supabase-client.js';
import './site-toasts.js';

const container = document.getElementById('auth-buttons');

function renderHeader(session) {
    if (container) {
        container.replaceChildren();
        const link = document.createElement('a');
        link.className = 'header__btn';
        link.href = session ? 'profile.html' : 'login.html';
        link.textContent = session ? 'Профиль' : 'Войти';
        container.appendChild(link);
    }

    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) {
        let accountLink = mobileMenu.querySelector('[data-mobile-account]');
        if (!accountLink) {
            accountLink = document.createElement('a');
            accountLink.dataset.mobileAccount = 'true';
            mobileMenu.appendChild(accountLink);
        }
        accountLink.className = 'mobile-menu__account';
        accountLink.href = session ? 'profile.html' : 'login.html';
        accountLink.textContent = session ? 'Мой профиль' : 'Войти в аккаунт';
    }
}

let deviceCheckInProgress = false;

async function checkDeviceAlive(session) {
    if (!session || deviceCheckInProgress) return;

    deviceCheckInProgress = true;
    try {
        if (window.profileDeviceSetup) {
            await window.profileDeviceSetup;
        }

        const deviceKey = localStorage.getItem('device_key');
        const deviceUserId = localStorage.getItem('device_user_id');
        if (deviceUserId && deviceUserId !== session.user.id) {
            localStorage.removeItem('device_key');
            localStorage.removeItem('device_user_id');
            return;
        }
        if (!deviceKey) return;

        const { data, error } = await supabase
            .from('devices')
            .select('device_key,last_active')
            .eq('user_id', session.user.id)
            .eq('device_key', deviceKey)
            .maybeSingle();

        if (error) {
            console.warn('Device check failed:', error);
            return;
        }
        if (!data) {
            localStorage.removeItem('device_key');
            localStorage.removeItem('device_user_id');
            localStorage.removeItem('pending_device_registration');
            await supabase.auth.signOut({ scope: 'local' });
            window.location.href = 'index.html';
            return;
        }

        if (Date.now() - new Date(data.last_active).getTime() > 60_000) {
            const { error: updateError } = await supabase
                .from('devices')
                .update({ last_active: new Date().toISOString() })
                .eq('user_id', session.user.id)
                .eq('device_key', deviceKey);
            if (updateError) console.warn('Device activity update failed:', updateError);
        }
    } catch (error) {
        console.error('Device check failed:', error);
    } finally {
        deviceCheckInProgress = false;
    }
}

if (container) {
    let hadSession = false;
    supabase.auth.getSession().then(({ data, error }) => {
        if (error) console.error('Header session lookup failed:', error);
        hadSession = Boolean(data?.session);
        renderHeader(data?.session || null);
        if (data?.session) checkDeviceAlive(data.session);
    }).catch(error => {
        console.error('Header session lookup failed:', error);
        renderHeader(null);
    });

    supabase.auth.onAuthStateChange((event, session) => {
        renderHeader(session);
        const shouldRedirectAfterSignOut = event === 'SIGNED_OUT' && hadSession;
        hadSession = Boolean(session);
        if (event === 'SIGNED_OUT') {
            localStorage.removeItem('device_key');
            localStorage.removeItem('device_user_id');
            localStorage.removeItem('pending_device_registration');
        }
        if (event === 'SIGNED_IN' && session) checkDeviceAlive(session);
        if (
            shouldRedirectAfterSignOut &&
            !window.location.pathname.includes('login.html') &&
            !window.location.pathname.includes('register.html')
        ) {
            window.location.href = 'index.html';
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            supabase.auth.getSession().then(({ data, error }) => {
                if (error) console.warn('Device session lookup failed:', error);
                else checkDeviceAlive(data?.session);
            });
        }
    });

    window.setInterval(async () => {
        if (document.visibilityState !== 'visible') return;
        const { data, error } = await supabase.auth.getSession();
        if (error) console.warn('Device session lookup failed:', error);
        else checkDeviceAlive(data?.session);
    }, 5000);
}
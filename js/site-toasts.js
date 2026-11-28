import { supabase } from './supabase-client.js';

const initializationKey = Symbol.for('drdarsun.site-toasts.initialized');
const shouldInitializeToasts = !window[initializationKey];
if (shouldInitializeToasts) window[initializationKey] = true;

const shownToastIds = new Set();
let publicToastChannel;
let privateToastChannel;
let privateUserId;

function wasToastShown(id) {
    if (shownToastIds.has(id)) return true;
    try {
        const key = `drdarsun:site-toast:${id}`;
        const expiresAt = Number(sessionStorage.getItem(key));
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return true;
        if (expiresAt) sessionStorage.removeItem(key);
    } catch (error) {
        console.warn('Site notification display state could not be read:', error.message);
    }
    return false;
}

function showSiteToast(notification) {
    if (!notification?.id || wasToastShown(notification.id)) return;
    const expiresAt = new Date(notification.expires_at).getTime();
    const durationMs = expiresAt - Date.now();
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    shownToastIds.add(notification.id);
    try {
        sessionStorage.setItem(`drdarsun:site-toast:${notification.id}`, String(expiresAt));
    } catch (error) {
        console.warn('Site notification display state could not be saved:', error.message);
    }

    if (typeof window.showToast === 'function') {
        const toast = window.showToast(notification.message, notification.kind, durationMs);
        if (toast instanceof HTMLElement) {
            toast.dataset.toastId = notification.id;
            toast.dataset.expiresAt = String(expiresAt);
        }
    } else {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${notification.kind}`;
        toast.dataset.expiresAt = String(expiresAt);
        toast.textContent = notification.message;
        container.appendChild(toast);
        toast.dataset.toastId = notification.id;
        container.scrollTop = container.scrollHeight;
        requestAnimationFrame(() => toast.classList.add('show'));
        window.setTimeout(() => {
            toast.classList.remove('show');
            window.setTimeout(() => toast.remove(), 400);
        }, Math.max(1000, durationMs));
    }
    window.setTimeout(() => shownToastIds.delete(notification.id), durationMs);
}

async function startPublicToasts() {
    publicToastChannel = supabase
        .channel('site-public-toasts')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'site_public_toasts'
        }, payload => showSiteToast(payload.new))
        .on('postgres_changes', {
            event: 'DELETE',
            schema: 'public',
            table: 'site_public_toasts'
        }, payload => {
            const id = payload.old?.id;
            if (id) {
                shownToastIds.delete(id);
                document.querySelectorAll('.toast[data-toast-id]')
                    .forEach(toast => { if (toast.dataset.toastId === id) toast.remove(); });
            }
        })
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Public site notifications are unavailable:', status);
            }
        });

    const loadActivePublicToasts = async () => {
        let data = null;
        let error = null;
        const result = await supabase
            .from('site_public_toasts')
            .select('id,message,kind,expires_at')
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: true })
            .limit(20);
        data = result.data;
        error = result.error;

        if (error) {
            try {
                const response = await fetch('https://drdarsun-site-main.layero.app/api/public-toasts', {
                    cache: 'default',
                    signal: AbortSignal.timeout(15_000)
                });
                if (response.ok) {
                    const fallback = await response.json();
                    data = Array.isArray(fallback.notifications) ? fallback.notifications : [];
                    error = null;
                }
            } catch (fallbackError) {
                console.warn('Public site notifications could not be loaded:', fallbackError.message);
            }
        }
        if (error) {
            console.warn('Public site notifications could not be loaded:', error.message);
            return;
        }
        (data || []).forEach(notification => showSiteToast(notification));
    };

    await loadActivePublicToasts();
}

async function startPrivateToasts(session) {
    const userId = session?.user?.id || null;
    if (userId === privateUserId && privateToastChannel) return;

    if (privateToastChannel) {
        await supabase.removeChannel(privateToastChannel);
        privateToastChannel = null;
    }
    privateUserId = userId;
    if (!userId) return;

    privateToastChannel = supabase
        .channel(`site-toasts:${userId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'site_toast_notifications',
            filter: `user_id=eq.${userId}`
        }, payload => showSiteToast(payload.new))
        .on('postgres_changes', {
            event: 'DELETE',
            schema: 'public',
            table: 'site_toast_notifications',
            filter: `user_id=eq.${userId}`
        }, payload => {
            const id = payload.old?.id;
            if (!id) return;
            shownToastIds.delete(id);
            document.querySelectorAll('.toast[data-toast-id]')
                .forEach(toast => { if (toast.dataset.toastId === id) toast.remove(); });
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'site_toast_notifications',
            filter: `user_id=eq.${userId}`
        }, payload => {
            if (!payload.new?.dismissed_at || !payload.new?.id) return;
            shownToastIds.delete(payload.new.id);
            document.querySelectorAll('.toast[data-toast-id]')
                .forEach(toast => { if (toast.dataset.toastId === payload.new.id) toast.remove(); });
        })
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Personal site notifications are unavailable:', status);
            }
        });

    const loadActivePrivateToasts = async () => {
        const { data, error } = await supabase
            .from('site_toast_notifications')
            .select('id,message,kind,expires_at')
            .eq('user_id', userId)
            .is('dismissed_at', null)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: true })
            .limit(20);
        if (error) {
            console.warn('Personal site notifications could not be loaded:', error.message);
            return;
        }
        (data || []).forEach(notification => showSiteToast(notification));
    };

    await loadActivePrivateToasts();
}

if (shouldInitializeToasts) {
    startPublicToasts().catch(error => {
        console.error('Public site notifications could not be initialized:', error);
    });

    supabase.auth.getSession()
        .then(({ data, error }) => {
            if (error) console.warn('Site notification session lookup failed:', error.message);
            return startPrivateToasts(data?.session);
        })
        .catch(error => console.warn('Site notifications could not be initialized:', error));

    supabase.auth.onAuthStateChange((_event, session) => {
        queueMicrotask(() => {
            startPrivateToasts(session).catch(error => {
                console.warn('Site notifications could not be updated:', error);
            });
        });
    });
}

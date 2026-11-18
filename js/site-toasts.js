import { supabase } from './supabase-client.js';

const shownToastIds = new Set();
let publicToastChannel;
let privateToastChannel;
let privateUserId;

function showSiteToast(notification, { privateNotification = false } = {}) {
    if (!notification?.id || shownToastIds.has(notification.id)) return;

    const durationMs = new Date(notification.expires_at).getTime() - Date.now();
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;

    shownToastIds.add(notification.id);

    if (typeof window.showToast === 'function') {
        window.showToast(notification.message, notification.kind, durationMs);
    } else {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${notification.kind}`;
        toast.textContent = notification.message;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        window.setTimeout(() => {
            toast.classList.remove('show');
            window.setTimeout(() => toast.remove(), 400);
        }, Math.max(1000, durationMs));
    }

    if (privateNotification) {
        supabase.from('site_toast_notifications')
            .update({ dismissed_at: new Date().toISOString() })
            .eq('id', notification.id)
            .is('dismissed_at', null)
            .then(({ error }) => {
                if (error) console.warn('Site notification acknowledgement failed:', error.message);
            });
    }
}

async function startPublicToasts() {
    publicToastChannel = supabase
        .channel('site-public-toasts')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'site_public_toasts'
        }, payload => showSiteToast(payload.new))
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Public site notifications are unavailable:', status);
            }
        });

    const { data, error } = await supabase
        .from('site_public_toasts')
        .select('id,message,kind,expires_at')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(20);

    if (error) {
        console.warn('Public site notifications could not be loaded:', error.message);
        return;
    }

    (data || []).forEach(notification => showSiteToast(notification));
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
        }, payload => showSiteToast(payload.new, { privateNotification: true }))
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Personal site notifications are unavailable:', status);
            }
        });

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

    (data || []).forEach(notification =>
        showSiteToast(notification, { privateNotification: true })
    );
}

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
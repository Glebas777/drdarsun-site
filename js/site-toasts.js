import { supabase } from './supabase-client.js';

const shownToastIds = new Set();
let activeToastChannel;

function showSiteToast(notification) {
    if (!notification?.id || shownToastIds.has(notification.id)) return;
    const expiresAt = new Date(notification.expires_at).getTime();
    const durationMs = expiresAt - Date.now();
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

    supabase.from('site_toast_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', notification.id)
        .is('dismissed_at', null)
        .then(({ error }) => {
            if (error) console.warn('Site notification acknowledgement failed:', error.message);
        });
}

async function startSiteToasts(session) {
    if (activeToastChannel) {
        await supabase.removeChannel(activeToastChannel);
        activeToastChannel = null;
    }
    if (!session?.user?.id) return;

    activeToastChannel = supabase
        .channel(`site-toasts:${session.user.id}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'site_toast_notifications',
            filter: `user_id=eq.${session.user.id}`
        }, payload => showSiteToast(payload.new))
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Live site notifications are unavailable:', status);
            }
        });

    const { data, error } = await supabase
        .from('site_toast_notifications')
        .select('id,message,kind,expires_at')
        .eq('user_id', session.user.id)
        .is('dismissed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(20);
    if (error) {
        console.warn('Site notifications could not be loaded:', error.message);
        return;
    }
    (data || []).forEach(showSiteToast);
}

supabase.auth.getSession()
    .then(({ data, error }) => {
        if (error) console.warn('Site notification session lookup failed:', error.message);
        return startSiteToasts(data?.session);
    })
    .catch(error => console.warn('Site notifications could not be initialized:', error));

supabase.auth.onAuthStateChange((_event, session) => {
    queueMicrotask(() => {
        startSiteToasts(session).catch(error => {
            console.warn('Site notifications could not be updated:', error);
        });
    });
});

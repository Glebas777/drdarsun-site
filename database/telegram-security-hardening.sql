BEGIN;

ALTER TABLE public.telegram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_webhook_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.telegram_accounts,
    public.telegram_link_requests,
    public.telegram_webhook_updates,
    public.telegram_bot_states,
    public.telegram_admin_audit
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_accounts,
    public.telegram_link_requests,
    public.telegram_webhook_updates,
    public.telegram_bot_states,
    public.telegram_admin_audit
    TO service_role;

REVOKE ALL ON public.notification_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_settings TO service_role;

DROP POLICY IF EXISTS "Users manage their own notification settings"
    ON public.notification_settings;
CREATE POLICY "Users manage their own notification settings"
    ON public.notification_settings
    FOR ALL
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER FUNCTION public.confirm_telegram_link(text, text, text)
    SET search_path = pg_catalog;
ALTER FUNCTION public.claim_telegram_webhook_update(text, bigint)
    SET search_path = pg_catalog;
ALTER FUNCTION public.complete_telegram_webhook_update(text, bigint)
    SET search_path = pg_catalog;
ALTER FUNCTION public.retry_telegram_webhook_update(text, bigint)
    SET search_path = pg_catalog;

REVOKE ALL ON FUNCTION public.confirm_telegram_link(text, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_telegram_webhook_update(text, bigint)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_telegram_webhook_update(text, bigint)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_telegram_webhook_update(text, bigint)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_telegram_link(text, text, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_telegram_webhook_update(text, bigint)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_telegram_webhook_update(text, bigint)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_telegram_webhook_update(text, bigint)
    TO service_role;

COMMIT;

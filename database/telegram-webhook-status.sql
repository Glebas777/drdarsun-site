begin;

update public.telegram_webhook_updates
set status = 'pending', locked_at = null
where status is null or status not in ('pending', 'processing', 'completed');

alter table public.telegram_webhook_updates
    drop constraint if exists telegram_webhook_updates_status_check,
    add constraint telegram_webhook_updates_status_check
        check (status in ('pending', 'processing', 'completed'));

commit;

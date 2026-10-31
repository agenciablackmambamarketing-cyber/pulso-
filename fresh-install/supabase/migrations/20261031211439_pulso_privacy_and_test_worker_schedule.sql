create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
select cron.schedule('pulso-retention-hourly','17 * * * *',
  $job$select public.pulso_retention_cleanup(); select public.pulso_purge_hotmart_context();$job$);
select cron.schedule('pulso-meta-test-worker','*/5 * * * *',
  $job$select net.http_post(
      url := 'https://utmfnskpfyykkakmxkcn.supabase.co/functions/v1/meta-worker',
      headers := jsonb_build_object('Content-Type','application/json',
        'x-pulso-worker-secret', public.pulso_runtime_config('meta_worker')->>'PULSO_META_WORKER_SECRET'),
      body := '{}'::jsonb, timeout_milliseconds := 10000)
    where exists(select 1 from private.conversion_event_outbox
      where provider='meta' and test_mode=true and next_attempt_at<=now()
        and (status='pending' or (status='sending' and lease_expires_at<now())));$job$);
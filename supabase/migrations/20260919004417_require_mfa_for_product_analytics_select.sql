    drop policy if exists product_analytics_events_select_admin
      on public.product_analytics_events;

    create policy product_analytics_events_select_admin
    on public.product_analytics_events
    for select
    to authenticated
    using ((select private.is_admin_mfa()));
  

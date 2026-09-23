-- Read-only aggregates for the daily QA report (docs/daily-qa.md).
-- Counts only: no user ids, paths or free text leave the database.
with window_bounds as (
  select now() - interval '24 hours' as since, now() - interval '8 days' as week_since
)
select 'client_error' as kind, context as name, error_code as detail, coalesce(platform, '-') as platform,
       count(*) filter (where created_at >= (select since from window_bounds)) as last_24h,
       count(*) as last_8d
from public.client_error_events
where created_at >= (select week_since from window_bounds)
group by context, error_code, platform
union all
select 'product_event', event_name, '-', coalesce(platform, '-'),
       count(*) filter (where created_at >= (select since from window_bounds)),
       count(*)
from public.product_analytics_events
where created_at >= (select week_since from window_bounds)
group by event_name, platform
order by kind, last_24h desc, last_8d desc
limit 60;

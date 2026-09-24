-- Read-only hourly error aggregates. Daily QA retains its own top-60 query.
-- No row limit: all contexts must contribute to each error-code total.
with window_bounds as (
  select
    now() - interval '24 hours' as since,
    now() - interval '8 days' as week_since,
    date_trunc('hour', now()) - interval '1 hour' as current_hour_start,
    date_trunc('hour', now()) as current_hour_end
),
error_code_history as (
  select
    e.error_code,
    count(*) filter (
      where extract(hour from e.created_at at time zone 'Asia/Seoul')
        = extract(hour from b.current_hour_start at time zone 'Asia/Seoul')
    ) as error_code_same_hour_prev_7d,
    count(*) as error_code_prev_7d
  from public.client_error_events e
  cross join window_bounds b
  where e.created_at >= b.current_hour_start - interval '7 days'
    and e.created_at < b.current_hour_start
  group by e.error_code
)
select
       'client_error' as kind,
       e.context as name,
       e.error_code as detail,
       coalesce(e.platform, '-') as platform,
       count(*) filter (where e.created_at >= b.since) as last_24h,
       count(*) as last_8d,
       count(*) filter (
         where e.created_at >= b.current_hour_start
           and e.created_at < b.current_hour_end
       ) as last_complete_hour,
       count(*) filter (
         where e.created_at >= b.current_hour_start - interval '7 days'
           and e.created_at < b.current_hour_end - interval '1 day'
           and extract(hour from e.created_at at time zone 'Asia/Seoul')
             = extract(hour from b.current_hour_start at time zone 'Asia/Seoul')
       ) as same_hour_prev_7d,
       coalesce(max(h.error_code_same_hour_prev_7d), 0) as error_code_same_hour_prev_7d,
       coalesce(max(h.error_code_prev_7d), 0) as error_code_prev_7d,
       b.current_hour_start,
       b.current_hour_end
from public.client_error_events e
cross join window_bounds b
left join error_code_history h on h.error_code = e.error_code
where e.created_at >= b.week_since
group by e.context, e.error_code, e.platform, b.current_hour_start, b.current_hour_end
having count(*) filter (
  where e.created_at >= b.current_hour_start and e.created_at < b.current_hour_end
) > 0
order by last_complete_hour desc, e.error_code, e.context, e.platform;

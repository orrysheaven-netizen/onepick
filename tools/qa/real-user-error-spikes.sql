-- Read-only error aggregates from the last 24 completed UTC hours.
-- Every hour is evaluated independently against the preceding seven days.
with bounds as (
  select date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC' as hour_end
),
current_locations as (
  select
    date_trunc('hour', e.created_at at time zone 'UTC') at time zone 'UTC' as hour_start,
    e.error_code, e.context, e.platform, count(*)::bigint as event_count
  from public.client_error_events e
  cross join bounds b
  where e.created_at >= b.hour_end - interval '24 hours'
    and e.created_at < b.hour_end
  group by 1, 2, 3, 4
),
previous_code_hours as (
  select
    date_trunc('hour', e.created_at at time zone 'UTC') at time zone 'UTC' as hour_start,
    e.error_code, count(*)::bigint as event_count
  from public.client_error_events e
  cross join bounds b
  where e.created_at >= b.hour_end - interval '8 days'
    and e.created_at < b.hour_end
  group by 1, 2
),
active_codes as (
  select distinct hour_start, error_code from current_locations
),
code_history as (
  select
    a.hour_start, a.error_code,
    coalesce(sum(p.event_count), 0)::bigint as error_code_prev_7d,
    coalesce(sum(p.event_count) filter (
      where extract(hour from p.hour_start at time zone 'Asia/Seoul') =
            extract(hour from a.hour_start at time zone 'Asia/Seoul')
    ), 0)::bigint as error_code_same_hour_prev_7d
  from active_codes a
  left join previous_code_hours p
    on p.error_code = a.error_code
   and p.hour_start >= a.hour_start - interval '7 days'
   and p.hour_start < a.hour_start
  group by 1, 2
)
select
  'client_error' as kind,
  c.context as name, c.error_code as detail, coalesce(c.platform, '-') as platform,
  c.event_count as last_complete_hour,
  h.error_code_same_hour_prev_7d, h.error_code_prev_7d,
  c.hour_start as current_hour_start,
  c.hour_start + interval '1 hour' as current_hour_end
from current_locations c
join code_history h
  on h.hour_start = c.hour_start and h.error_code = c.error_code
order by c.hour_start, c.error_code, c.context, c.platform;

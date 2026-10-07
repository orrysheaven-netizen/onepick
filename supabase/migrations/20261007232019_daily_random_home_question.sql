begin;

-- A date-seeded draw: every caller sees the same menu for the Korean calendar day.
-- No administrator setting, cron, stored selection, or caller-supplied date is used.
create function public.home_daily_question()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.categories c
  where public.category_is_open_leaf(c.id)
    and private.category_is_food(c.id)
  order by pg_catalog.md5(
    pg_catalog.to_char(current_timestamp at time zone 'Asia/Seoul', 'YYYY-MM-DD')
    || ':' || c.id::text
  ), c.id
  limit 1;
$$;

revoke all on function public.home_daily_question() from public, anon, authenticated;
grant execute on function public.home_daily_question() to anon, authenticated;
comment on function public.home_daily_question() is
  'Daily date-seeded random open food menu for Home; calendar boundary Asia/Seoul. Returns null only when no eligible menu exists.';

commit;

-- One current Pick per card. This is browsing, not following or popularity.
-- Keep legacy product aggregates unchanged for older clients during rollout.
create function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  return query
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  left join public.categories parent on parent.id = c.parent_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not public.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and c.status = 'open' and c.is_visible and c.is_pickable
    and not exists (select 1 from public.categories child where child.parent_id = c.id)
    and (c.parent_id is null or (
      parent.parent_id is null and parent.status = 'open'
      and parent.is_visible and not parent.is_pickable
    ))
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;
revoke all on function public.home_pick_feed_page(timestamptz,uuid) from public;
grant execute on function public.home_pick_feed_page(timestamptz,uuid) to anon, authenticated, service_role;
comment on function public.home_pick_feed_page(timestamptz,uuid) is
  'Person-first home: current public picks, no self or popularity threshold, caller RLS, 20 rows + lookahead.';

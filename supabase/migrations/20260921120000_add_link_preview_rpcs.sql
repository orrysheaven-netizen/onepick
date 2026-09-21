-- Social link previews for shared OnePick URLs.
-- The web MVP is a single-page export, so no per-route HTML exists for a chat
-- app or crawler to read. The edge renderer builds that HTML, and it needs one
-- anonymous read per link with exactly the visibility rules the app itself
-- applies. Both functions are SECURITY INVOKER with a fixed search path: the
-- renderer calls them with the public anon key, so caller RLS decides, and a
-- suspended author, a hidden item and a closed category stay out of a preview
-- the same way they stay out of the feed.
create function public.link_preview_profile(p_username text)
returns table(
  username text,
  pick_count integer,
  ai_summary text,
  ai_keywords text[],
  picks jsonb
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  target uuid;
begin
  select pr.id into target
  from public.profiles pr
  where pr.username = lower(btrim(coalesce(p_username, '')))
    and not private.user_is_suspended(pr.id);
  if target is null then
    return;
  end if;

  return query
  with visible as (
    select p.id, p.started_at, c.name as category_name, i.name as item_name, p.one_line_review
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    where p.user_id = target
      and p.status = 'active'
      and i.status in ('active', 'discontinued')
      and public.category_is_open_leaf(c.id)
  )
  select
    pr.username,
    (select count(*)::integer from visible),
    -- Only a review its owner published. A generated but hidden one stays hidden.
    r.summary,
    r.keywords,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'categoryName', v.category_name,
        'itemName', v.item_name,
        'oneLineReview', v.one_line_review
      ) order by v.started_at desc, v.id desc)
      from (select * from visible order by started_at desc, id desc limit 3) v
    ), '[]'::jsonb)
  from public.profiles pr
  left join public.profile_ai_reviews r on r.profile_id = pr.id and r.is_visible
  where pr.id = target;
end;
$$;
revoke all on function public.link_preview_profile(text) from public;
grant execute on function public.link_preview_profile(text) to anon, authenticated, service_role;
comment on function public.link_preview_profile(text) is
  'Link preview for /u/<username>: public pick count, up to 3 current Picks and a published AI summary. Caller RLS.';

create function public.link_preview_pick(p_pick_id uuid)
returns table(
  username text,
  category_name text,
  item_name text,
  one_line_review text
)
language sql stable security invoker set search_path = ''
as $$
  select pr.username, c.name, i.name, p.one_line_review
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.id = p_pick_id
    and p.status = 'active'
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and public.category_is_open_leaf(c.id);
$$;
revoke all on function public.link_preview_pick(uuid) from public;
grant execute on function public.link_preview_pick(uuid) to anon, authenticated, service_role;
comment on function public.link_preview_pick(uuid) is
  'Link preview for /pick/<id>: the author, category, item and one-line review of one current public Pick. Caller RLS.';

-- Home 팔로잉 tab: expose the Pick's channel like the 전체 tab does.
--
-- home_pick_feed_page returns `channels` (the food Pick's own channel, or the
-- item's channels for other Picks) and the app compares item + channel to show
-- `✓ 내 원픽` only for the same product in the same channel (#448 결정 6).
-- home_following_feed_page had no channel column, so following cards lost the
-- Pick's channel and the app could not apply the same rule. Same rows, same
-- order, same cursor and RLS; one more column.

begin;

drop function if exists public.home_following_feed_page(timestamptz, uuid);

create function public.home_following_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz, channels text[]
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
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at,
    -- Same rule as home_pick_feed_page: a food Pick shows the channel it was
    -- picked under; other Picks keep the item's channels (normally none).
    case
      when p.channel is not null then array[p.channel]
      else coalesce(
        array(
          select ch.channel
          from public.item_channels ch
          where ch.item_id = i.id
          order by ch.channel
        ),
        array[]::text[]
      )
    end
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and exists (
      select 1 from public.user_follows f
      where f.follower_id = (select auth.uid()) and f.followee_id = p.user_id
    )
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and public.category_is_open_leaf(c.id)
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_following_feed_page(timestamptz, uuid) from public, anon;
grant execute on function public.home_following_feed_page(timestamptz, uuid) to authenticated;
comment on function public.home_following_feed_page(timestamptz, uuid) is
  'Home 팔로잉 tab: current public picks by people the caller follows, caller RLS, 20 rows + lookahead, with the Pick channel like home_pick_feed_page.';

commit;

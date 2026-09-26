-- Explore menu search: "미역국" opens one menu with 매장 / 온라인 / 레시피 lists.
--
-- * 미역국 joins the restaurant soup leaves (same shape as 도가니탕).
-- * explore_menu_channel_items lists one menu's items per sales channel
--   (매장/온라인). The 레시피 list comes from the separate 레시피 category
--   (YouTube recipe videos) through search_items, so it is not part of this RPC.

begin;

insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,'미역국','miyeokguk','open',true,true,23
from public.categories p
where p.slug='food-soups-rice'
on conflict(slug) do update set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=true,
  sort_order=excluded.sort_order,
  updated_at=now();

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,place_catalog_enabled,notes
)
select c.id,'internal',null,null,null,true,true,
       'Restaurant-first internal taxonomy; online/offline can share the same leaf category.'
from public.categories c
where c.slug='miyeokguk'
on conflict(category_id) do update set
  mode='internal',
  provider=null,
  edge_function_slug=null,
  external_source=null,
  is_enabled=true,
  place_catalog_enabled=true,
  notes=excluded.notes,
  updated_at=now();

with seed(category_slug,term,kind) as (
  values
  ('miyeokguk','소고기미역국','alias'),
  ('miyeokguk','조개미역국','alias'),
  ('miyeokguk','가자미미역국','alias')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;

-- One menu's items per channel, most-picked first. Visibility matches
-- private.item_accepts_pick (inlined: that helper is not granted to anon):
-- provider-backed items need an active provider and, when offline, a visible
-- place; legacy offline items need a visible place. Items without a Pick yet
-- are listed too, and p_limit applies per channel.
create or replace function public.explore_menu_channel_items(
  p_category_id uuid,
  p_limit integer default 20
)
returns table(
  channel text, item_id uuid, item_name text,
  thumbnail_path text, image_path text, image_source_url text,
  pick_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with counts as (
    select p.item_id, count(*) as pick_count
    from public.picks p
    where p.category_id=p_category_id
      and p.status='active'
      and not private.user_is_suspended(p.user_id)
    group by p.item_id
  ),
  ranked as (
    select ch.channel, i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url,
      coalesce(c.pick_count,0) as pick_count,
      row_number() over (
        partition by ch.channel
        order by coalesce(c.pick_count,0) desc, i.name, i.id
      ) as position
    from public.items i
    join public.item_channels ch on ch.item_id=i.id
    left join counts c on c.item_id=i.id
    where i.category_id=p_category_id
      and i.status in ('active','discontinued')
      and public.category_is_open_leaf(p_category_id)
      and case
        when exists (select 1 from public.item_providers ipr where ipr.item_id=i.id) then exists (
          select 1
          from public.item_providers ipr
          join public.providers pr on pr.id=ipr.provider_id
          left join public.places pl on pl.id=pr.place_id
          where ipr.item_id=i.id
            and pr.status='active'
            and (pr.kind='online_store' or pl.is_visible)
        )
        else (
          ch.channel<>'offline'
          or exists (
            select 1
            from public.item_places ip
            join public.places pl on pl.id=ip.place_id
            where ip.item_id=i.id
              and pl.is_visible
          )
        )
      end
  )
  select r.channel, r.id, r.name, r.thumbnail_path, r.image_path, r.image_source_url, r.pick_count
  from ranked r
  where r.position<=least(greatest(coalesce(p_limit,20),1),50)
  order by r.channel, r.position;
$$;

revoke all on function public.explore_menu_channel_items(uuid,integer) from public;
grant execute on function public.explore_menu_channel_items(uuid,integer) to anon, authenticated, service_role;

commit;

begin;

-- 내장탕 joins the restaurant soup leaves with the same shape as 도가니탕:
-- an open pickable leaf, internal catalog, and place-backed selection.

insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,'내장탕','naejangtang','open',true,true,23
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
where c.slug='naejangtang'
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
  ('naejangtang','내장','tag'),
  ('naejangtang','내장국','alias'),
  ('naejangtang','소내장탕','alias')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;

-- 중앙해장 (삼성점) is picked for its 내장탕, not as a 해장국 place. Move the item and
-- its Picks together so each Pick keeps pointing at an item in its own category.
-- Guarded by id and current category: a no-op on every database but production,
-- and on a re-run after the move.
do $move$
declare
  v_item constant uuid := 'bf83d0fc-1019-42d1-9529-a0d0e4c2d7bf';
  v_from uuid := (select id from public.categories where slug='haejangguk');
  v_to uuid := (select id from public.categories where slug='naejangtang');
  v_fk record;
  v_tables text[] := '{}';
  v_names text[] := '{}';
  i int;
begin
  if not exists(select 1 from public.items where id=v_item and category_id=v_from) then
    return;
  end if;
  -- A user who already holds a current 내장탕 Pick would end up with two.
  if exists(
    select 1 from public.picks mine
    join public.picks other on other.user_id=mine.user_id and other.category_id=v_to
      and other.status in ('active','needs_review')
    where mine.item_id=v_item and mine.status in ('active','needs_review')
  ) then
    raise exception 'NAEJANGTANG_MOVE_CONFLICT';
  end if;

  -- Picks, item_places and item_providers reference items(id, category_id) with
  -- immediate FKs, so no update order satisfies them. Defer them for this
  -- transaction only, move every row, then restore them as they were. Earlier
  -- statements may have queued deferred checks; flush them before any ALTER.
  set constraints all immediate;
  for v_fk in
    select c.conrelid::regclass::text tbl, c.conname
    from pg_constraint c
    where c.confrelid='public.items'::regclass and c.contype='f' and not c.condeferrable
      and pg_get_constraintdef(c.oid) like 'FOREIGN KEY (item_id, category_id) REFERENCES %items(id, category_id)%'
  loop
    v_tables := v_tables || v_fk.tbl;
    v_names := v_names || v_fk.conname::text;
    execute format('alter table %s alter constraint %I deferrable initially immediate', v_fk.tbl, v_fk.conname);
    execute format('set constraints %I deferred', v_fk.conname);
  end loop;

  -- Place/provider-backed items carry '<place or provider id>:<category id>' as
  -- their identity; keep it pointing at the new category.
  update public.items
  set category_id=v_to,
      external_id=case when external_id like '%:'||v_from::text
        then left(external_id, length(external_id)-length(v_from::text))||v_to::text
        else external_id end,
      updated_at=now()
  where id=v_item;
  for i in 1..coalesce(array_length(v_tables,1),0) loop
    execute format('update %s set category_id=$1 where item_id=$2 and category_id=$3', v_tables[i]) using v_to, v_item, v_from;
  end loop;

  -- Fire every deferred check now (these FKs, and item_places' deferred provider
  -- consistency trigger): ALTER TABLE refuses a table with pending trigger events.
  set constraints all immediate;
  for i in 1..coalesce(array_length(v_tables,1),0) loop
    execute format('alter table %s alter constraint %I not deferrable', v_tables[i], v_names[i]);
  end loop;
end;
$move$;

commit;

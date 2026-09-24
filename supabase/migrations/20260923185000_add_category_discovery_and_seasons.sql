begin;

-- Discovery is intentionally separate from pick eligibility.
-- A fine leaf can remain searchable/pickable while broad Explore surfaces wait
-- until enough real catalog/pick data exists to avoid a wall of empty chips.
create table public.category_discovery_rules (
  category_id uuid primary key references public.categories(id) on delete cascade,
  mode text not null default 'always' check (mode in ('always','threshold')),
  min_item_count integer check (min_item_count is null or min_item_count >= 1),
  min_active_pick_count integer check (min_active_pick_count is null or min_active_pick_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint category_discovery_rules_threshold_valid check (
    (mode='always' and min_item_count is null and min_active_pick_count is null)
    or
    (mode='threshold' and (min_item_count is not null or min_active_pick_count is not null))
  )
);

create trigger category_discovery_rules_set_updated_at
before update on public.category_discovery_rules
for each row execute function private.set_updated_at();

alter table public.category_discovery_rules enable row level security;
revoke all on public.category_discovery_rules from public, anon, authenticated;
grant select on public.category_discovery_rules to anon, authenticated;

create policy category_discovery_rules_public_read
on public.category_discovery_rules
for select to anon, authenticated
using (
  exists (
    select 1
    from public.categories c
    where c.id = category_id
      and c.is_visible
      and c.status in ('open','paused','closed')
  )
);

create table public.category_seasons (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 40),
  start_month smallint not null check (start_month between 1 and 12),
  end_month smallint not null check (end_month between 1 and 12),
  priority smallint not null default 0 check (priority between -1000 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(category_id,start_month,end_month,label)
);

create index category_seasons_months_idx
  on public.category_seasons(start_month,end_month,priority desc);

create trigger category_seasons_set_updated_at
before update on public.category_seasons
for each row execute function private.set_updated_at();

alter table public.category_seasons enable row level security;
revoke all on public.category_seasons from public, anon, authenticated;
grant select on public.category_seasons to anon, authenticated;

create policy category_seasons_public_read
on public.category_seasons
for select to anon, authenticated
using (
  exists (
    select 1
    from public.categories c
    where c.id = category_id
      and c.is_visible
      and c.status in ('open','paused','closed')
  )
);

create or replace function public.category_is_discoverable(p_category_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select c.id, r.mode, r.min_item_count, r.min_active_pick_count
    from public.categories c
    left join public.category_discovery_rules r on r.category_id = c.id
    where c.id = p_category_id
      and public.category_is_open_leaf(c.id)
  ),
  counts as (
    select
      t.id,
      count(distinct i.id) filter (where i.status in ('active','discontinued'))::integer as item_count,
      count(distinct p.id) filter (where p.status='active')::integer as active_pick_count
    from target t
    left join public.items i on i.category_id=t.id
    left join public.picks p on p.category_id=t.id
    group by t.id
  )
  select coalesce((
    select
      case
        when t.mode is null or t.mode='always' then true
        else
          (t.min_item_count is not null and c.item_count >= t.min_item_count)
          or
          (t.min_active_pick_count is not null and c.active_pick_count >= t.min_active_pick_count)
      end
    from target t
    join counts c on c.id=t.id
  ), false);
$$;

revoke all on function public.category_is_discoverable(uuid) from public;
grant execute on function public.category_is_discoverable(uuid) to anon, authenticated, service_role;

create or replace function public.browse_categories()
returns setof public.categories
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  item_counts as (
    select i.category_id, count(*)::integer as item_count
    from public.items i
    where i.status in ('active','discontinued')
    group by i.category_id
  ),
  pick_counts as (
    select p.category_id, count(*)::integer as active_pick_count
    from public.picks p
    where p.status='active'
    group by p.category_id
  ),
  discoverable as (
    select c.id, c.parent_id
    from public.categories c
    left join public.category_discovery_rules r on r.category_id=c.id
    left join item_counts ic on ic.category_id=c.id
    left join pick_counts pc on pc.category_id=c.id
    where public.category_is_open_leaf(c.id)
      and (
        r.category_id is null
        or r.mode='always'
        or (
          r.mode='threshold'
          and (
            (r.min_item_count is not null and coalesce(ic.item_count,0) >= r.min_item_count)
            or
            (r.min_active_pick_count is not null and coalesce(pc.active_pick_count,0) >= r.min_active_pick_count)
          )
        )
      )
  ),
  visible_tree(id,parent_id) as (
    select d.id,d.parent_id from discoverable d
    union
    select p.id,p.parent_id
    from public.categories p
    join visible_tree v on p.id=v.parent_id
  )
  select c.*
  from public.categories c
  where c.id in (select id from visible_tree)
  order by c.sort_order,c.name,c.id;
$$;

revoke all on function public.browse_categories() from public;
grant execute on function public.browse_categories() to anon, authenticated, service_role;

create or replace function public.seasonal_category_recommendations(
  p_on_date date default current_date,
  p_limit integer default 8
)
returns table(
  category_id uuid,
  category_name text,
  category_slug text,
  season_label text,
  item_count integer,
  active_pick_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  params as (
    select
      extract(month from coalesce(p_on_date,current_date))::integer as month_no,
      least(greatest(coalesce(p_limit,8),1),20) as row_limit
  ),
  item_counts as (
    select i.category_id, count(*)::integer as item_count
    from public.items i
    where i.status in ('active','discontinued')
    group by i.category_id
  ),
  pick_counts as (
    select p.category_id, count(*)::integer as active_pick_count
    from public.picks p
    where p.status='active'
    group by p.category_id
  )
  select
    c.id,
    c.name,
    c.slug,
    s.label,
    coalesce(ic.item_count,0),
    coalesce(pc.active_pick_count,0)
  from public.category_seasons s
  join public.categories c on c.id=s.category_id
  cross join params x
  left join item_counts ic on ic.category_id=c.id
  left join pick_counts pc on pc.category_id=c.id
  left join public.category_discovery_rules r on r.category_id=c.id
  where public.category_is_open_leaf(c.id)
    and (
      case
        when s.start_month <= s.end_month
          then x.month_no between s.start_month and s.end_month
        else x.month_no >= s.start_month or x.month_no <= s.end_month
      end
    )
    and (
      r.category_id is null
      or r.mode='always'
      or (
        r.mode='threshold'
        and (
          (r.min_item_count is not null and coalesce(ic.item_count,0) >= r.min_item_count)
          or
          (r.min_active_pick_count is not null and coalesce(pc.active_pick_count,0) >= r.min_active_pick_count)
        )
      )
    )
  order by s.priority desc, coalesce(pc.active_pick_count,0) desc,
           coalesce(ic.item_count,0) desc, c.name, c.id
  limit (select row_limit from params);
$$;

revoke all on function public.seasonal_category_recommendations(date,integer) from public;
grant execute on function public.seasonal_category_recommendations(date,integer)
  to anon, authenticated, service_role;

-- Fine leaves: keep the existing broad 김/회 leaves for compatibility, but make
-- the user-visible pick unit more precise for new catalog/place-backed items.
with seed(parent_slug,name,slug,sort_order) as (
  values
    ('food-seaweed-dried','곱창김','gopchang-gim',10),
    ('food-seaweed-dried','돌김','dol-gim',11),
    ('food-seaweed-dried','재래김','jaerae-gim',12),
    ('food-seaweed-dried','파래김','parae-gim',13),
    ('food-seafood','광어회','flatfish-sashimi',30),
    ('food-seafood','우럭회','rockfish-sashimi',31),
    ('food-seafood','도다리회','flounder-sashimi',32),
    ('food-seafood','민어회','mineo-sashimi',33),
    ('food-seafood','전어회','jeoneo-sashimi',34),
    ('food-seafood','방어회','yellowtail-sashimi',35)
)
insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,s.name,s.slug,'open',true,true,s.sort_order
from seed s
join public.categories p on p.slug=s.parent_slug
on conflict(slug) do nothing;

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,notes
)
select c.id,'internal',null,null,null,true,
       'Fine food leaf; place-backed and online items may share the same category.'
from public.categories c
where c.slug in (
  'gopchang-gim','dol-gim','jaerae-gim','parae-gim',
  'flatfish-sashimi','rockfish-sashimi','flounder-sashimi',
  'mineo-sashimi','jeoneo-sashimi','yellowtail-sashimi'
)
on conflict(category_id) do update set
  mode='internal',
  provider=null,
  edge_function_slug=null,
  external_source=null,
  is_enabled=true,
  notes=excluded.notes,
  updated_at=now();

-- The old broad 김 search tag must not steal the exact fine-leaf result.
delete from public.category_search_terms t
using public.categories c
where t.category_id=c.id
  and c.slug='seaweed'
  and lower(t.term)=lower('곱창김');

with seed(category_slug,term,kind) as (
  values
    ('gopchang-gim','곱창 김','alias'),
    ('dol-gim','돌 김','alias'),
    ('jaerae-gim','재래 김','alias'),
    ('parae-gim','파래 김','alias'),
    ('flatfish-sashimi','광어','tag'),
    ('rockfish-sashimi','우럭','tag'),
    ('flounder-sashimi','도다리','tag'),
    ('mineo-sashimi','민어','tag'),
    ('jeoneo-sashimi','전어','tag'),
    ('yellowtail-sashimi','방어','tag'),
    ('yellowtail-sashimi','대방어','tag')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;

-- Sparse food leaves stay valid for search/registration but do not clutter
-- category browsing. They graduate automatically at 3 public catalog items OR
-- 3 current Picks. Existing well-populated food leaves remain always visible.
with recursive food_tree(id) as (
  select id from public.categories where slug='food'
  union all
  select c.id
  from public.categories c
  join food_tree p on c.parent_id=p.id
),
sparse as (
  select c.id
  from public.categories c
  join food_tree f on f.id=c.id
  where c.status='open'
    and c.is_visible
    and c.is_pickable
    and public.category_is_open_leaf(c.id)
    and (
      select count(*)
      from public.items i
      where i.category_id=c.id and i.status in ('active','discontinued')
    ) < 3
    and (
      select count(*)
      from public.picks p
      where p.category_id=c.id and p.status='active'
    ) < 3
)
insert into public.category_discovery_rules(
  category_id,mode,min_item_count,min_active_pick_count
)
select id,'threshold',3,3 from sparse
on conflict(category_id) do nothing;

-- Editorial season windows for Korea. These are display/recommendation metadata,
-- not taxonomy and not eligibility rules.
with seed(category_slug,label,start_month,end_month,priority) as (
  values
    ('flounder-sashimi','봄 제철',3,5,80),
    ('mineo-sashimi','여름 제철',6,8,80),
    ('jeoneo-sashimi','가을 제철',9,10,90),
    ('yellowtail-sashimi','겨울 제철',11,2,90)
)
insert into public.category_seasons(category_id,label,start_month,end_month,priority)
select c.id,s.label,s.start_month,s.end_month,s.priority
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,start_month,end_month,label) do update set
  priority=excluded.priority,
  updated_at=now();

commit;

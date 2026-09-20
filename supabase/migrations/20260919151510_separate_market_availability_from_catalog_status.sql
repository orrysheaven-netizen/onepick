alter table public.items
  add column market_availability_status text not null default 'unknown';

alter table public.items
  add constraint items_market_availability_status_check
  check (market_availability_status in ('current','discontinued','unknown'));

comment on column public.items.market_availability_status is
  'Market-sale state, independent of catalog eligibility: current, discontinued, or unknown.';

comment on column public.items.status is
  'Catalog/moderation state. Market-sale state is stored separately in market_availability_status.';

-- Backfill from curated verification evidence where available.
update public.items i
set market_availability_status =
  case v.verification_state
    when 'verified_active' then 'current'
    when 'verified_discontinued' then 'discontinued'
    else 'unknown'
  end
from public.item_catalog_verifications v
where v.item_id=i.id;

-- Legacy ramen imports with uncertain current sale status should still be
-- visible/selectable in OnePick. Keep their market status unknown.
update public.items i
set status='active',
    market_availability_status='unknown',
    updated_at=now()
from public.categories c
join public.item_catalog_verifications v on true
where i.category_id=c.id
  and c.slug='ramen'
  and i.status='pending'
  and i.created_by is null
  and v.item_id=i.id
  and v.verification_state='needs_review';

create or replace function private.sync_item_market_availability()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  update public.items
  set market_availability_status =
    case new.verification_state
      when 'verified_active' then 'current'
      when 'verified_discontinued' then 'discontinued'
      else 'unknown'
    end,
    updated_at=now()
  where id=new.item_id;

  return new;
end;
$function$;

revoke all on function private.sync_item_market_availability() from public;
revoke all on function private.sync_item_market_availability() from anon;
revoke all on function private.sync_item_market_availability() from authenticated;

drop trigger if exists item_catalog_verifications_sync_market_status
on public.item_catalog_verifications;

create trigger item_catalog_verifications_sync_market_status
after insert or update of verification_state
on public.item_catalog_verifications
for each row
execute function private.sync_item_market_availability();

create or replace function public.search_items(
  p_query text,
  p_category_ids uuid[] default null::uuid[],
  p_limit integer default 20
)
returns setof public.items
language sql
stable
set search_path=''
as $function$
  with params as (
    select
      lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g')) as q,
      least(greatest(coalesce(p_limit,20),1),50) as safe_limit
  ),
  ranked as (
    select
      i.*,
      case
        when i.normalized_name=params.q then 0
        when coalesce(alias_match.exact_match,false) then 1
        when i.normalized_name like params.q||'%' then 2
        when coalesce(alias_match.prefix_match,false) then 3
        when i.normalized_name like '%'||params.q||'%' then 4
        when coalesce(alias_match.contains_match,false) then 5
        else 6
      end as match_rank,
      greatest(
        extensions.similarity(i.normalized_name,params.q),
        coalesce(alias_match.best_similarity,0)
      ) as similarity_score
    from public.items i
    join public.categories c on c.id=i.category_id
    left join public.categories parent on parent.id=c.parent_id
    cross join params
    left join lateral (
      select
        bool_or(ia.normalized_alias=params.q) as exact_match,
        bool_or(ia.normalized_alias like params.q||'%') as prefix_match,
        bool_or(ia.normalized_alias like '%'||params.q||'%') as contains_match,
        max(extensions.similarity(ia.normalized_alias,params.q)) as best_similarity
      from public.item_aliases ia
      where ia.item_id=i.id
        and (
          ia.normalized_alias like '%'||params.q||'%'
          or ia.normalized_alias operator(extensions.%) params.q
        )
    ) alias_match on true
    where params.q<>''
      and i.status in ('active','discontinued')
      and (p_category_ids is null or i.category_id=any(p_category_ids))
      and c.status='open'
      and c.is_visible=true
      and c.is_pickable=true
      and not exists(select 1 from public.categories child where child.parent_id=c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status='open'
          and parent.is_visible=true
          and parent.is_pickable=false
        )
      )
      and (
        i.normalized_name like '%'||params.q||'%'
        or i.normalized_name operator(extensions.%) params.q
        or coalesce(alias_match.exact_match,false)
        or coalesce(alias_match.prefix_match,false)
        or coalesce(alias_match.contains_match,false)
        or coalesce(alias_match.best_similarity,0)>=0.2
      )
  )
  select
    id,category_id,brand_id,name,normalized_name,model_code,official_url,status,
    merged_into_item_id,created_by,created_at,updated_at,image_path,thumbnail_path,
    image_source_url,external_source,external_id,original_name,release_year,
    creator_name,collection_name,external_refreshed_at,market_availability_status
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$function$;


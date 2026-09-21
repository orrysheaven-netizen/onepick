begin;

-- Search-first registration, step 5: when none of the AI-suggested categories
-- fit, the requester may describe the category in free text. The text is a
-- hint for the administrator who assigns the real category during review; it
-- never creates a category row.
alter table public.items
  add column requested_category_label text;

alter table public.items
  add constraint items_requested_category_label_check
  check (
    requested_category_label is null
    or char_length(btrim(requested_category_label)) between 1 and 60
  );

-- The requester may write or clear the hint on their own pending request.
create or replace function private.set_pending_item_category_hint_impl(
  p_item_id uuid,
  p_label text
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_label text := nullif(regexp_replace(btrim(coalesce(p_label,'')),'[[:space:]]+',' ','g'),'');
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='P0001';
  end if;

  if v_label is not null and char_length(v_label) > 60 then
    raise exception 'CATEGORY_LABEL_INVALID' using errcode='P0001';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id
  for update;

  if not found or v_item.created_by is distinct from v_user then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  if v_item.status<>'pending' then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  update public.items
  set requested_category_label=v_label
  where id=v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.set_pending_item_category_hint(
  p_item_id uuid,
  p_label text default null
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.set_pending_item_category_hint_impl(p_item_id,p_label);
$$;

revoke all on function private.set_pending_item_category_hint_impl(uuid,text)
  from public, anon;
grant execute on function private.set_pending_item_category_hint_impl(uuid,text)
  to authenticated, service_role;
revoke all on function public.set_pending_item_category_hint(uuid,text)
  from public, anon;
grant execute on function public.set_pending_item_category_hint(uuid,text)
  to authenticated, service_role;

-- search_items returns SETOF items, so keep the exact composite row order after
-- adding requested_category_label at the end of the items table.
create or replace function public.search_items(
  p_query text,
  p_category_ids uuid[] default null,
  p_limit integer default 20
)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
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
      and public.category_is_open_leaf(c.id)
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
    creator_name,collection_name,external_refreshed_at,market_availability_status,
    requested_category_label
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$$;

commit;

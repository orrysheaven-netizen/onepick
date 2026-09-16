create extension if not exists pg_trgm with schema extensions;

create table public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_aliases_alias_length check (char_length(btrim(alias)) between 1 and 100),
  constraint product_aliases_normalized_length check (char_length(normalized_alias) between 1 and 100),
  constraint product_aliases_product_normalized_unique unique (product_id, normalized_alias)
);

create index product_aliases_product_id_idx on public.product_aliases(product_id);
create index product_aliases_normalized_trgm_idx on public.product_aliases using gin (normalized_alias extensions.gin_trgm_ops);
create index products_normalized_name_trgm_idx on public.products using gin (normalized_name extensions.gin_trgm_ops);

create function private.prepare_product_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_alias text;
  v_normalized text;
begin
  v_alias := regexp_replace(btrim(new.alias), '[[:space:]]+', ' ', 'g');
  v_normalized := lower(regexp_replace(v_alias, '[[:space:]]+', '', 'g'));

  if char_length(v_alias) not between 1 and 100 or char_length(v_normalized) not between 1 and 100 then
    raise exception 'ALIAS_INVALID' using errcode='P0001';
  end if;

  select category_id into v_category_id from public.products where id = new.product_id;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0001'; end if;

  perform pg_advisory_xact_lock(hashtextextended('product-alias:' || v_category_id::text || ':' || v_normalized, 0));

  if exists (
    select 1 from public.products p
    where p.id = new.product_id and p.normalized_name = v_normalized
  ) then
    raise exception 'ALIAS_REDUNDANT' using errcode='P0001';
  end if;

  if exists (
    select 1 from public.products p
    where p.id <> new.product_id
      and p.category_id = v_category_id
      and p.status not in ('merged', 'rejected')
      and p.normalized_name = v_normalized
  ) then
    raise exception 'ALIAS_CONFLICT' using errcode='P0001';
  end if;

  if exists (
    select 1
    from public.product_aliases pa
    join public.products p on p.id = pa.product_id
    where pa.id <> new.id
      and pa.product_id <> new.product_id
      and p.category_id = v_category_id
      and p.status not in ('merged', 'rejected')
      and pa.normalized_alias = v_normalized
  ) then
    raise exception 'ALIAS_CONFLICT' using errcode='P0001';
  end if;

  new.alias := v_alias;
  new.normalized_alias := v_normalized;
  return new;
end;
$$;

revoke all on function private.prepare_product_alias() from public, anon, authenticated;
create trigger prepare_product_alias
before insert or update of product_id, alias on public.product_aliases
for each row execute function private.prepare_product_alias();

create trigger set_product_aliases_updated_at
before update on public.product_aliases
for each row execute function private.set_updated_at();

alter table public.product_aliases enable row level security;

create policy product_aliases_public_read
on public.product_aliases for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.id = product_id
      and p.status in ('active', 'discontinued')
      and c.status = 'open'
      and c.is_visible = true
      and c.is_pickable = true
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status = 'open'
          and parent.is_visible = true
          and parent.is_pickable = false
        )
      )
  )
);

create policy product_aliases_admin_read
on public.product_aliases for select
to authenticated
using ((select private.is_admin((select auth.uid()))));

create policy product_aliases_admin_insert
on public.product_aliases for insert
to authenticated
with check ((select private.is_admin((select auth.uid()))));

create policy product_aliases_admin_update
on public.product_aliases for update
to authenticated
using ((select private.is_admin((select auth.uid()))))
with check ((select private.is_admin((select auth.uid()))));

create policy product_aliases_admin_delete
on public.product_aliases for delete
to authenticated
using ((select private.is_admin((select auth.uid()))));

grant select on public.product_aliases to anon, authenticated;
grant insert, update, delete on public.product_aliases to authenticated;

create or replace function public.search_products(
  p_query text,
  p_category_ids uuid[] default null,
  p_limit integer default 20
)
returns setof public.products
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      lower(regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')) as q,
      least(greatest(coalesce(p_limit, 20), 1), 50) as safe_limit
  ), ranked as (
    select
      p.*,
      case
        when p.normalized_name = params.q then 0
        when coalesce(alias_match.exact_match, false) then 1
        when p.normalized_name like params.q || '%' then 2
        when coalesce(alias_match.prefix_match, false) then 3
        when p.normalized_name like '%' || params.q || '%' then 4
        when coalesce(alias_match.contains_match, false) then 5
        else 6
      end as match_rank,
      greatest(
        extensions.similarity(p.normalized_name, params.q),
        coalesce(alias_match.best_similarity, 0)
      ) as similarity_score
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    cross join params
    left join lateral (
      select
        bool_or(pa.normalized_alias = params.q) as exact_match,
        bool_or(pa.normalized_alias like params.q || '%') as prefix_match,
        bool_or(pa.normalized_alias like '%' || params.q || '%') as contains_match,
        max(extensions.similarity(pa.normalized_alias, params.q)) as best_similarity
      from public.product_aliases pa
      where pa.product_id = p.id
        and (
          pa.normalized_alias like '%' || params.q || '%'
          or pa.normalized_alias operator(extensions.%) params.q
        )
    ) alias_match on true
    where params.q <> ''
      and p.status in ('active', 'discontinued')
      and (p_category_ids is null or p.category_id = any(p_category_ids))
      and c.status = 'open'
      and c.is_visible = true
      and c.is_pickable = true
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status = 'open'
          and parent.is_visible = true
          and parent.is_pickable = false
        )
      )
      and (
        p.normalized_name like '%' || params.q || '%'
        or p.normalized_name operator(extensions.%) params.q
        or coalesce(alias_match.exact_match, false)
        or coalesce(alias_match.prefix_match, false)
        or coalesce(alias_match.contains_match, false)
        or coalesce(alias_match.best_similarity, 0) >= 0.2
      )
  )
  select
    id,
    category_id,
    brand_id,
    name,
    normalized_name,
    model_code,
    official_url,
    status,
    merged_into_product_id,
    created_by,
    created_at,
    updated_at,
    image_path,
    thumbnail_path,
    image_source_url
  from ranked
  order by match_rank asc, similarity_score desc, name asc
  limit (select safe_limit from params);
$$;

revoke all on function public.search_products(text, uuid[], integer) from public;
grant execute on function public.search_products(text, uuid[], integer) to anon, authenticated;

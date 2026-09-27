begin;

-- Optional public SNS links for provider profiles. A provider may have at most
-- one link per supported platform. User clients only read; AAL2 admins replace
-- the set atomically through the RPC below.
create table public.provider_social_links (
  provider_id uuid not null references public.providers(id) on delete cascade,
  platform text not null,
  url text not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider_id, platform),
  constraint provider_social_links_platform_check check (
    platform in ('instagram','youtube','tiktok','threads','facebook','x','naver_blog','blog')
  ),
  constraint provider_social_links_url_check check (
    char_length(url) <= 2048
    and url ~ '^https://[^[:space:]]+$'
  ),
  constraint provider_social_links_sort_check check (sort_order between 0 and 1000)
);

create trigger provider_social_links_set_updated_at
before update on public.provider_social_links
for each row execute function private.set_updated_at();

alter table public.provider_social_links enable row level security;

revoke all on public.provider_social_links from public, anon, authenticated;
grant select on public.provider_social_links to anon, authenticated;
grant all on public.provider_social_links to service_role;

create policy provider_social_links_anon_read on public.provider_social_links
for select to anon
using (
  exists (
    select 1
    from public.providers p
    where p.id=provider_social_links.provider_id
  )
);

create policy provider_social_links_authenticated_read on public.provider_social_links
for select to authenticated
using (
  (select private.is_admin_mfa())
  or exists (
    select 1
    from public.providers p
    where p.id=provider_social_links.provider_id
  )
);

create or replace function private.admin_replace_provider_social_links_impl(
  p_provider_id uuid,
  p_links jsonb
)
returns setof public.provider_social_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
  v_link jsonb;
  v_position bigint;
  v_platform text;
  v_url text;
  v_sort integer;
  v_seen text[] := '{}'::text[];
  v_count integer := 0;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_provider
  from public.providers
  where id=p_provider_id
  for update;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  if p_links is null or jsonb_typeof(p_links)<>'array' or jsonb_array_length(p_links)>10 then
    raise exception 'PROVIDER_SOCIAL_LINKS_INVALID' using errcode='P0001';
  end if;

  -- Validate the full replacement before writing anything.
  for v_link, v_position in
    select value, ordinality
    from jsonb_array_elements(p_links) with ordinality
  loop
    if jsonb_typeof(v_link)<>'object' then
      raise exception 'PROVIDER_SOCIAL_LINK_INVALID' using errcode='P0001';
    end if;

    v_platform := lower(btrim(coalesce(v_link->>'platform','')));
    v_url := btrim(coalesce(v_link->>'url',''));

    if v_platform not in ('instagram','youtube','tiktok','threads','facebook','x','naver_blog','blog')
       or v_url=''
       or char_length(v_url)>2048
       or v_url !~ '^https://[^[:space:]]+$'
       or v_platform=any(v_seen)
    then
      raise exception 'PROVIDER_SOCIAL_LINK_INVALID' using errcode='P0001';
    end if;

    if v_link ? 'sort_order' then
      if coalesce(v_link->>'sort_order','') !~ '^[0-9]{1,4}$' then
        raise exception 'PROVIDER_SOCIAL_LINK_INVALID' using errcode='P0001';
      end if;
      v_sort := (v_link->>'sort_order')::integer;
    else
      v_sort := (v_position-1)::integer;
    end if;

    if v_sort not between 0 and 1000 then
      raise exception 'PROVIDER_SOCIAL_LINK_INVALID' using errcode='P0001';
    end if;

    v_seen := array_append(v_seen,v_platform);
  end loop;

  delete from public.provider_social_links
  where provider_id=p_provider_id;

  for v_link, v_position in
    select value, ordinality
    from jsonb_array_elements(p_links) with ordinality
  loop
    v_platform := lower(btrim(v_link->>'platform'));
    v_url := btrim(v_link->>'url');
    v_sort := case when v_link ? 'sort_order'
      then (v_link->>'sort_order')::integer
      else (v_position-1)::integer
    end;

    insert into public.provider_social_links(provider_id,platform,url,sort_order)
    values(p_provider_id,v_platform,v_url,v_sort);
    v_count := v_count+1;
  end loop;

  insert into public.admin_audit_logs(
    actor_user_id,entity_type,entity_id,action,summary
  )
  values(
    (select auth.uid()),
    'provider',
    p_provider_id,
    'social_links_update',
    jsonb_build_object('count',v_count,'platforms',to_jsonb(v_seen))
  );

  return query
  select l.*
  from public.provider_social_links l
  where l.provider_id=p_provider_id
  order by l.sort_order,l.platform;
end;
$$;

revoke all on function private.admin_replace_provider_social_links_impl(uuid,jsonb)
  from public, anon;
grant execute on function private.admin_replace_provider_social_links_impl(uuid,jsonb)
  to authenticated;

create or replace function public.admin_replace_provider_social_links(
  p_provider_id uuid,
  p_links jsonb
)
returns setof public.provider_social_links
language sql
security invoker
set search_path = ''
as $$
  select * from private.admin_replace_provider_social_links_impl(p_provider_id,p_links);
$$;

revoke all on function public.admin_replace_provider_social_links(uuid,jsonb)
  from public, anon;
grant execute on function public.admin_replace_provider_social_links(uuid,jsonb)
  to authenticated;

commit;

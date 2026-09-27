-- Admin review of 온라인 판매처 requests (registration → 온라인 → "온라인 판매처 등록 요청").
-- A request is a caller-created pending item with the seller link in
-- items.official_url. Resolving it creates (or reuses) the online provider item
-- in the request's category and merges the pending request into it, in one
-- transaction so a failed merge never leaves a half-resolved request.
--
-- Both steps keep their existing guards: admin_upsert_online_provider_item
-- (AAL2 admin, store identity, online_stores_not_delivery_app) and
-- admin_merge_pending_item (pending source, same category, no Picks on source).

begin;

create or replace function public.admin_resolve_online_seller_request(
  p_item_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid,
  merged_item_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.items%rowtype;
  v_provider record;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_request
  from public.items i
  where i.id=p_item_id
  for update;

  if not found or v_request.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  select * into v_provider
  from public.admin_upsert_online_provider_item(
    v_request.category_id,p_name,p_store_type,p_official_url,
    p_platform,p_store_key,null
  );

  perform public.admin_merge_pending_item(v_request.id,v_provider.item_id);

  provider_id := v_provider.provider_id;
  online_store_id := v_provider.online_store_id;
  item_id := v_provider.item_id;
  category_id := v_provider.category_id;
  merged_item_id := v_request.id;
  return next;
end;
$$;

revoke all on function public.admin_resolve_online_seller_request(uuid,text,text,text,text,text)
  from public, anon;
grant execute on function public.admin_resolve_online_seller_request(uuid,text,text,text,text,text)
  to authenticated;

commit;

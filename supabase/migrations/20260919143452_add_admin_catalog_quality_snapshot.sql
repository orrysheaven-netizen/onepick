create or replace function public.admin_catalog_quality_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode='42501';
  end if;

  with internal_categories as (
    select c.id, c.name, c.slug
    from public.category_catalog_sources s
    join public.categories c on c.id=s.category_id
    where s.mode='internal'
      and s.is_enabled
  ),
  catalog_rows as (
    select
      c.id as category_id,
      c.name as category_name,
      c.slug as category_slug,
      i.id as item_id,
      i.status,
      i.brand_id,
      i.official_url,
      v.verification_state,
      v.verified_at
    from internal_categories c
    left join public.items i
      on i.category_id=c.id
      and i.status in ('active','discontinued','pending')
    left join public.item_catalog_verifications v
      on v.item_id=i.id
  ),
  summary as (
    select
      category_id,
      category_name,
      category_slug,
      count(item_id)::int as total_items,
      count(*) filter (where status='active')::int as active_items,
      count(*) filter (where status='discontinued')::int as discontinued_items,
      count(*) filter (where status='pending')::int as pending_items,
      count(*) filter (
        where item_id is not null
          and status in ('active','discontinued')
          and brand_id is null
      )::int as brand_missing,
      count(*) filter (
        where item_id is not null
          and status in ('active','discontinued')
          and official_url is null
      )::int as official_link_missing,
      count(*) filter (
        where item_id is not null
          and status in ('active','discontinued')
          and verification_state is null
      )::int as verification_missing,
      count(*) filter (
        where item_id is not null
          and verification_state='needs_review'
      )::int as needs_review,
      count(*) filter (
        where item_id is not null
          and verification_state='verified_active'
      )::int as verified_active,
      count(*) filter (
        where item_id is not null
          and verification_state='verified_discontinued'
      )::int as verified_discontinued,
      max(verified_at) as last_verified_at
    from catalog_rows
    group by category_id,category_name,category_slug
  )
  select jsonb_build_object(
    'generated_at', now(),
    'categories', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category_id', category_id,
          'category_name', category_name,
          'category_slug', category_slug,
          'total_items', total_items,
          'active_items', active_items,
          'discontinued_items', discontinued_items,
          'pending_items', pending_items,
          'brand_missing', brand_missing,
          'official_link_missing', official_link_missing,
          'verification_missing', verification_missing,
          'needs_review', needs_review,
          'verified_active', verified_active,
          'verified_discontinued', verified_discontinued,
          'last_verified_at', last_verified_at
        )
        order by category_name
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from summary;

  return v_result;
end;
$function$;

revoke all on function public.admin_catalog_quality_snapshot() from public;
revoke all on function public.admin_catalog_quality_snapshot() from anon;
grant execute on function public.admin_catalog_quality_snapshot() to authenticated;


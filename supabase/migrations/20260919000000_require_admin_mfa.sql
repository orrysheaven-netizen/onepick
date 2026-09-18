-- Require a step-up (AAL2) session for every real administrator data path.
--
-- private.is_admin(uuid) stays membership-only: the MFA enrollment/verification
-- flow (mobile/src/services/adminMfaService.ts) calls public.current_user_is_admin()
-- before the session can ever reach AAL2, so that check must keep working for an
-- allowlisted admin who has not stepped up yet. A brand-new gate,
-- private.is_admin_mfa(), is introduced instead and swapped into every RLS policy
-- and SECURITY DEFINER function that authorizes the *current caller* to act as an
-- administrator. Checks that look up whether some OTHER (target) user is an admin
-- (e.g. to protect that user from suspension, or to show an "is_admin" flag in a
-- listing) are left untouched, since AAL is only meaningful for the caller's own
-- session, not for an arbitrary target uuid.
begin;

-- coalesce(...,false) is required, not cosmetic: `auth.jwt()->>'aal'` is null when
-- no aal claim is present, and `true and null` evaluates to null in SQL. Several
-- call sites below use `if not private.is_admin_mfa() then raise ...`, and in
-- PL/pgSQL a null condition is treated like false and silently skips the raise --
-- i.e. a null return here would have been a bypass, not merely an inconvenience.
create or replace function private.is_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_admin((select auth.uid()))
    and (select auth.jwt() ->> 'aal') = 'aal2',
    false
  );
$$;

revoke all on function private.is_admin_mfa() from public;
grant execute on function private.is_admin_mfa() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies: swap the actor-authorization branch to the AAL2-gated check.
-- Every ALTER POLICY below reproduces the policy's current full definition
-- (same name, role and command) with only the is_admin(...) sub-expression
-- replaced, so nothing else about the policy's behavior changes.
-- ---------------------------------------------------------------------------

alter policy categories_admin_insert on public.categories
  with check ((select private.is_admin_mfa()));

alter policy categories_admin_update on public.categories
  using ((select private.is_admin_mfa()))
  with check ((select private.is_admin_mfa()));

alter policy categories_authenticated_read on public.categories
  using (
    (
      is_visible = true
      and status = any (array['open'::text, 'paused'::text, 'closed'::text])
    )
    or (select private.is_admin_mfa())
  );

alter policy brands_admin_insert on public.brands
  with check ((select private.is_admin_mfa()));

alter policy brands_admin_update on public.brands
  using ((select private.is_admin_mfa()))
  with check ((select private.is_admin_mfa()));

alter policy brands_authenticated_read on public.brands
  using (
    is_active = true
    or (select private.is_admin_mfa())
  );

alter policy items_admin_insert on public.items
  with check ((select private.is_admin_mfa()));

alter policy items_admin_update on public.items
  using ((select private.is_admin_mfa()))
  with check ((select private.is_admin_mfa()));

alter policy items_authenticated_read on public.items
  using (
    status = any (array['active'::text, 'discontinued'::text])
    or created_by = (select auth.uid())
    or (select private.is_admin_mfa())
  );

alter policy item_aliases_admin_insert on public.item_aliases
  with check ((select private.is_admin_mfa()));

alter policy item_aliases_admin_update on public.item_aliases
  using ((select private.is_admin_mfa()))
  with check ((select private.is_admin_mfa()));

alter policy item_aliases_admin_delete on public.item_aliases
  using ((select private.is_admin_mfa()));

alter policy item_aliases_authenticated_read on public.item_aliases
  using (
    (select private.is_admin_mfa())
    or exists (
      select 1
      from public.items i
      join public.categories c on c.id = i.category_id
      left join public.categories parent on parent.id = c.parent_id
      where i.id = item_id
        and i.status in ('active', 'discontinued')
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

alter policy content_reports_read on public.content_reports
  using (
    reporter_user_id = (select auth.uid())
    or (select private.is_admin_mfa())
  );

alter policy content_reports_admin_update on public.content_reports
  using ((select private.is_admin_mfa()))
  with check ((select private.is_admin_mfa()));

alter policy profiles_authenticated_read on public.profiles
  using (
    id = (select auth.uid())
    or (select private.is_admin_mfa())
    or (
      not public.user_is_suspended(id)
      and not (select private.users_blocked((select auth.uid()), profiles.id))
    )
  );

alter policy picks_authenticated_read on public.picks
  using (
    (select private.is_admin_mfa())
    or user_id = (select auth.uid())
    or (
      status = 'active'
      and not public.user_is_suspended(user_id)
      and not (select private.users_blocked((select auth.uid()), picks.user_id))
    )
  );

alter policy comments_authenticated_read_visible_pick on public.comments
  using (
    (select private.is_admin_mfa())
    or (
      (
        user_id = (select auth.uid())
        or (
          not public.user_is_suspended(user_id)
          and not (select private.users_blocked((select auth.uid()), comments.user_id))
        )
      )
      and exists (
        select 1 from public.picks p
        where p.id = comments.pick_id
          and (
            p.user_id = (select auth.uid())
            or (
              p.status = 'active'
              and not public.user_is_suspended(p.user_id)
              and not (select private.users_blocked((select auth.uid()), p.user_id))
            )
          )
      )
    )
  );

alter policy admin_audit_logs_select_admin on public.admin_audit_logs
  using ((select private.is_admin_mfa()));

alter policy client_error_events_select_admin on public.client_error_events
  using ((select private.is_admin_mfa()));

alter policy home_settings_admin_update on public.home_settings
  using ((select private.is_admin_mfa()))
  with check ((select private.is_admin_mfa()));

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER RPCs: swap the actor-authorization guard only. Each
-- function's `private.is_admin(p_user_id)` / `private.is_admin(p.id)` calls
-- (checking a *different*, non-caller user) are intentionally left as-is.
-- ---------------------------------------------------------------------------

create or replace function public.admin_users(p_query text default '')
returns table(
  id uuid,
  username text,
  onboarding_completed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  moderation_status text,
  suspension_reason text,
  suspended_at timestamptz,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select p.id,
         p.username,
         p.onboarding_completed,
         p.created_at,
         p.updated_at,
         case when m.user_id is null then 'active'::text else 'suspended'::text end,
         m.reason,
         m.suspended_at,
         private.is_admin(p.id)
  from public.profiles p
  left join private.user_moderation m on m.user_id = p.id
  where coalesce(btrim(p_query), '') = ''
     or p.username ilike '%' || btrim(p_query) || '%'
  order by p.created_at desc
  limit 100;
end;
$$;
revoke all on function public.admin_users(text) from public, anon;
grant execute on function public.admin_users(text) to authenticated;

create or replace function public.admin_user_moderation(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.user_moderation%rowtype;
  v_is_admin boolean;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_is_admin := private.is_admin(p_user_id);
  select * into v_row from private.user_moderation where user_id = p_user_id;
  if found then
    return jsonb_build_object(
      'user_id', p_user_id,
      'status', 'suspended',
      'reason', v_row.reason,
      'suspended_at', v_row.suspended_at,
      'is_admin', v_is_admin
    );
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'status', 'active',
    'reason', null,
    'suspended_at', null,
    'is_admin', v_is_admin
  );
end;
$$;
revoke all on function public.admin_user_moderation(uuid) from public, anon;
grant execute on function public.admin_user_moderation(uuid) to authenticated;

create or replace function public.admin_set_user_suspension(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_row private.user_moderation%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if private.is_admin(p_user_id) then
    raise exception 'ADMIN_CANNOT_BE_SUSPENDED' using errcode = 'P0001';
  end if;

  if p_suspended then
    if v_reason is null or char_length(v_reason) > 500 then
      raise exception 'SUSPENSION_REASON_REQUIRED' using errcode = 'P0001';
    end if;

    insert into private.user_moderation(user_id, reason, suspended_at, suspended_by)
    values (p_user_id, v_reason, now(), v_actor)
    on conflict (user_id) do update
      set reason = excluded.reason,
          suspended_at = excluded.suspended_at,
          suspended_by = excluded.suspended_by,
          updated_at = now();
  else
    delete from private.user_moderation where user_id = p_user_id;
  end if;

  insert into public.admin_audit_logs(actor_user_id, entity_type, entity_id, action, summary)
  values (
    v_actor,
    'user_moderation',
    p_user_id,
    'update',
    jsonb_build_object(
      'user_id', p_user_id,
      'status', case when p_suspended then 'suspended' else 'active' end,
      'reason', case when p_suspended then v_reason else null end
    )
  );

  select * into v_row from private.user_moderation where user_id = p_user_id;
  if found then
    return jsonb_build_object(
      'user_id', p_user_id,
      'status', 'suspended',
      'reason', v_row.reason,
      'suspended_at', v_row.suspended_at
    );
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'status', 'active',
    'reason', null,
    'suspended_at', null
  );
end;
$$;
revoke all on function public.admin_set_user_suspension(uuid,boolean,text) from public, anon;
grant execute on function public.admin_set_user_suspension(uuid,boolean,text) to authenticated;

-- admin_merge_pending_item was introduced by
-- 20260917105500_add_admin_pending_item_merge.sql (restored to this repo from
-- the live onepick-dev migration history, which had it but this repo did not).
-- That file is intentionally left with its original private.is_admin(...)
-- actor check -- it is history, not something to rewrite -- and this later
-- migration replaces just that guard, exactly as for every other admin RPC.
create or replace function public.admin_merge_pending_item(
  p_source_item_id uuid,
  p_target_item_id uuid
)
returns items
language plpgsql
set search_path to ''
as $function$
declare
  v_source public.items%rowtype;
  v_target public.items%rowtype;
  v_result public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_source_item_id is null
     or p_target_item_id is null
     or p_source_item_id = p_target_item_id then
    raise exception 'MERGE_TARGET_INVALID' using errcode = 'P0001';
  end if;

  select * into v_source
  from public.items
  where id = p_source_item_id
  for update;

  if not found or v_source.status <> 'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode = 'P0001';
  end if;

  select * into v_target
  from public.items
  where id = p_target_item_id
  for update;

  if not found or v_target.status not in ('active', 'discontinued') then
    raise exception 'TARGET_ITEM_INVALID' using errcode = 'P0001';
  end if;

  if v_source.category_id <> v_target.category_id then
    raise exception 'MERGE_CATEGORY_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.picks
    where item_id = v_source.id
  ) then
    raise exception 'SOURCE_ITEM_IN_USE' using errcode = 'P0001';
  end if;

  update public.items
  set status = 'merged',
      merged_into_item_id = v_target.id
  where id = v_source.id
  returning * into v_result;

  return v_result;
end;
$function$;
revoke all on function public.admin_merge_pending_item(uuid,uuid) from public, anon;
grant execute on function public.admin_merge_pending_item(uuid,uuid) to authenticated, service_role;

-- admin_dashboard_metrics never had an explicit revoke/grant pair (unlike every
-- other admin RPC here), so PostgREST was relying solely on its internal
-- is_admin check to keep anon/authenticated out. Lock the grant down to match
-- its siblings while we're tightening its authorization check.
create or replace function public.admin_dashboard_metrics()
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
begin
  if not private.is_admin_mfa() then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_suspended', (select count(*) from public.profiles p where public.user_is_suspended(p.id)),
    'categories_total', (select count(*) from public.categories),
    'categories_open', (select count(*) from public.categories where status = 'open'),
    'items_total', (select count(*) from public.items),
    'items_pending', (select count(*) from public.items where status = 'pending'),
    'items_active', (select count(*) from public.items where status = 'active'),
    'picks_total', (select count(*) from public.picks),
    'picks_active', (select count(*) from public.picks where status = 'active'),
    'reports_open', (select count(*) from public.content_reports where status in ('open', 'reviewing'))
  );
end;
$function$;
revoke all on function public.admin_dashboard_metrics() from public, anon;
grant execute on function public.admin_dashboard_metrics() to authenticated;

commit;

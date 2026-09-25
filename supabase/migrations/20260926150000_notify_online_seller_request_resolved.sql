-- Tell the requester when an admin links their 온라인 판매처 request to an
-- online provider, so they can pick it right away.
--
-- * item_request_notifications: one inbox row per resolved request (the
--   request item is merged, so its id is a stable key). No copies of text;
--   names are read live.
-- * private.notify_online_seller_request_resolved: the only writer. It is
--   security definer but re-checks AAL2 admin and that the request really was
--   merged into the given item, so it cannot be used to forge notifications.
-- * admin_resolve_online_seller_request now notifies in the same transaction.
-- * notification_page gains the 'seller_request' kind plus item_id/category_id
--   so the app can open the choose screen. Older clients drop unknown kinds.

begin;

create table public.item_request_notifications (
  request_item_id uuid primary key references public.items(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  resolved_item_id uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index item_request_notifications_recipient_created_idx
  on public.item_request_notifications(recipient_id, created_at desc, request_item_id desc);
create index item_request_notifications_unread_idx
  on public.item_request_notifications(recipient_id) where read_at is null;
alter table public.item_request_notifications enable row level security;
revoke all on public.item_request_notifications from public, anon, authenticated;
grant select on public.item_request_notifications to authenticated;
grant update(read_at) on public.item_request_notifications to authenticated;
grant all on public.item_request_notifications to service_role;
comment on table public.item_request_notifications is
  'Inbox references telling a requester that their 온라인 판매처 request was linked to an online provider item.';

-- Visible while the linked item can still be picked.
create policy item_request_notifications_read_own on public.item_request_notifications
for select to authenticated using (
  recipient_id = (select auth.uid())
  and exists (
    select 1 from public.items i
    where i.id = resolved_item_id and i.status = 'active'
  )
);
create policy item_request_notifications_mark_read_own on public.item_request_notifications
for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

create function private.notify_online_seller_request_resolved(
  p_request_item_id uuid,
  p_resolved_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_request from public.items where id = p_request_item_id;
  if not found
     or v_request.status <> 'merged'
     or v_request.merged_into_item_id is distinct from p_resolved_item_id then
    raise exception 'REQUEST_NOT_RESOLVED' using errcode='P0001';
  end if;

  -- Requests created without an owner (system imports) have nobody to tell.
  if v_request.created_by is null
     or private.user_is_suspended(v_request.created_by) then
    return;
  end if;

  insert into public.item_request_notifications(request_item_id, recipient_id, resolved_item_id)
  values (v_request.id, v_request.created_by, p_resolved_item_id)
  on conflict (request_item_id) do nothing;
end;
$$;
revoke all on function private.notify_online_seller_request_resolved(uuid, uuid) from public, anon;
grant execute on function private.notify_online_seller_request_resolved(uuid, uuid) to authenticated;

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
  perform private.notify_online_seller_request_resolved(v_request.id,v_provider.item_id);

  provider_id := v_provider.provider_id;
  online_store_id := v_provider.online_store_id;
  item_id := v_provider.item_id;
  category_id := v_provider.category_id;
  merged_item_id := v_request.id;
  return next;
end;
$$;

create or replace function public.notification_count()
returns bigint language sql stable security invoker set search_path = ''
as $$
  select (
    select count(*) from public.comment_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  ) + (
    select count(*) from public.pick_change_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  ) + (
    select count(*) from public.item_request_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  );
$$;

-- The return type gains item_id/category_id, so the function is recreated.
drop function public.notification_page(timestamptz, uuid);
create function public.notification_page(p_before_time timestamptz default null, p_before_id uuid default null)
returns table(
  kind text, id uuid, pick_id uuid, username text, body text, item_name text,
  created_at timestamptz, read_at timestamptz, item_id uuid, category_id uuid
)
language sql stable security invoker set search_path = ''
as $$
  select * from (
    select 'comment'::text, n.comment_id, c.pick_id, pr.username, c.body, i.name, n.created_at, n.read_at, i.id, p.category_id
    from public.comment_notifications n
    join public.comments c on c.id = n.comment_id
    join public.picks p on p.id = c.pick_id
    join public.profiles pr on pr.id = c.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'pick_change'::text, n.pick_id, n.pick_id, pr.username, p.one_line_review, i.name, n.created_at, n.read_at, i.id, p.category_id
    from public.pick_change_notifications n
    join public.picks p on p.id = n.pick_id
    join public.profiles pr on pr.id = p.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'seller_request'::text, n.request_item_id, null::uuid, null::text, c.name, i.name, n.created_at, n.read_at, i.id, i.category_id
    from public.item_request_notifications n
    join public.items i on i.id = n.resolved_item_id
    join public.categories c on c.id = i.category_id
    where n.recipient_id = (select auth.uid())
  ) rows(kind, id, pick_id, username, body, item_name, created_at, read_at, item_id, category_id)
  where (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
  order by created_at desc, id desc
  limit 21;
$$;
revoke all on function public.notification_page(timestamptz, uuid) from public, anon;
grant execute on function public.notification_page(timestamptz, uuid) to authenticated;
comment on function public.notification_page(timestamptz, uuid) is
  'Own inbox: comments on my picks, pick changes by people I follow and resolved 온라인 판매처 requests, newest first, caller RLS, 20 + lookahead.';

commit;

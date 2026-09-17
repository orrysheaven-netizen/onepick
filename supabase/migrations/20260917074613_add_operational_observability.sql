create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text not null check (entity_type in ('category','brand','product','content_report')),
  entity_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_created_at_idx on public.admin_audit_logs(created_at desc);
create index admin_audit_logs_actor_idx on public.admin_audit_logs(actor_user_id, created_at desc);
create index admin_audit_logs_entity_idx on public.admin_audit_logs(entity_type, entity_id, created_at desc);

alter table public.admin_audit_logs enable row level security;
grant select on public.admin_audit_logs to authenticated;

create policy admin_audit_logs_select_admin
on public.admin_audit_logs
for select
to authenticated
using ((select private.is_admin((select auth.uid()))));

create table public.client_error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  context text not null check (char_length(context) between 1 and 80),
  error_code text not null check (char_length(error_code) between 1 and 80),
  platform text null check (platform is null or char_length(platform) <= 24),
  app_version text null check (app_version is null or char_length(app_version) <= 32),
  created_at timestamptz not null default now()
);

create index client_error_events_created_at_idx on public.client_error_events(created_at desc);
create index client_error_events_code_idx on public.client_error_events(error_code, created_at desc);

alter table public.client_error_events enable row level security;
grant select, insert on public.client_error_events to authenticated;

create policy client_error_events_insert_own
on public.client_error_events
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy client_error_events_select_admin
on public.client_error_events
for select
to authenticated
using ((select private.is_admin((select auth.uid()))));

create or replace function private.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text := tg_argv[0];
  v_entity_id uuid;
  v_summary jsonb := '{}'::jsonb;
begin
  if not private.is_admin(v_actor) then
    return coalesce(new, old);
  end if;

  v_entity_id := case when tg_op = 'DELETE' then old.id else new.id end;

  if v_entity_type = 'product' then
    v_summary := jsonb_build_object(
      'name', coalesce(new.name, old.name),
      'status', coalesce(new.status, old.status),
      'category_id', coalesce(new.category_id, old.category_id)
    );
  elsif v_entity_type = 'category' then
    v_summary := jsonb_build_object(
      'name', coalesce(new.name, old.name),
      'status', coalesce(new.status, old.status)
    );
  elsif v_entity_type = 'brand' then
    v_summary := jsonb_build_object(
      'name', coalesce(new.name, old.name),
      'is_active', coalesce(new.is_active, old.is_active)
    );
  elsif v_entity_type = 'content_report' then
    v_summary := jsonb_build_object(
      'status', coalesce(new.status, old.status),
      'target_type', coalesce(new.target_type, old.target_type),
      'target_id', coalesce(new.target_id, old.target_id)
    );
  end if;

  insert into public.admin_audit_logs(actor_user_id, entity_type, entity_id, action, summary)
  values (v_actor, v_entity_type, v_entity_id, lower(tg_op), v_summary);

  return coalesce(new, old);
end;
$$;

revoke all on function private.log_admin_audit() from public, anon, authenticated;

create trigger categories_admin_audit
after insert or update or delete on public.categories
for each row execute function private.log_admin_audit('category');

create trigger brands_admin_audit
after insert or update or delete on public.brands
for each row execute function private.log_admin_audit('brand');

create trigger products_admin_audit
after insert or update or delete on public.products
for each row execute function private.log_admin_audit('product');

create trigger content_reports_admin_audit
after update or delete on public.content_reports
for each row execute function private.log_admin_audit('content_report');

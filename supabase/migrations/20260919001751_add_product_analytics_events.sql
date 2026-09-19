create table public.product_analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null default auth.uid() references auth.users(id) on delete set null,
  event_name text not null check (event_name in (
    'pick_created',
    'pick_share_clicked',
    'pick_link_opened',
    'item_detail_viewed',
    'auth_started',
    'auth_completed'
  )),
  pick_id uuid null references public.picks(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  category_id uuid null references public.categories(id) on delete set null,
  source text null check (source is null or char_length(source) between 1 and 40),
  path text null check (path is null or char_length(path) between 1 and 160),
  platform text null check (platform is null or char_length(platform) <= 24),
  app_version text null check (app_version is null or char_length(app_version) <= 32),
  created_at timestamptz not null default now()
);

create index product_analytics_events_created_at_idx
  on public.product_analytics_events(created_at desc);
create index product_analytics_events_name_idx
  on public.product_analytics_events(event_name, created_at desc);
create index product_analytics_events_user_idx
  on public.product_analytics_events(user_id, created_at desc)
  where user_id is not null;

alter table public.product_analytics_events enable row level security;

revoke all on table public.product_analytics_events from anon, authenticated;
grant insert on table public.product_analytics_events to anon, authenticated;
grant select on table public.product_analytics_events to authenticated;

create policy product_analytics_events_insert_session
on public.product_analytics_events
for insert
to anon, authenticated
with check (user_id is not distinct from (select auth.uid()));

create policy product_analytics_events_select_admin
on public.product_analytics_events
for select
to authenticated
using ((select private.is_admin((select auth.uid()))));

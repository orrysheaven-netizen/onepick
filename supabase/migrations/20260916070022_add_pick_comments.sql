create table public.comments (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(btrim(body)) between 1 and 300)
);

create index comments_pick_created_idx on public.comments(pick_id, created_at asc);
create index comments_user_idx on public.comments(user_id);

create trigger comments_set_updated_at
before update on public.comments
for each row execute function private.set_updated_at();

alter table public.comments enable row level security;

revoke all on public.comments from anon, authenticated;
grant select on public.comments to anon, authenticated;
grant insert, update, delete on public.comments to authenticated;

create policy comments_read_visible_pick
on public.comments
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.picks p
    where p.id = comments.pick_id
      and (
        p.status = 'active'
        or p.user_id = (select auth.uid())
      )
  )
);

create policy comments_insert_own_on_active_pick
on public.comments
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.picks p
    where p.id = comments.pick_id
      and p.status = 'active'
  )
);

create policy comments_update_own
on public.comments
for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.picks p
    where p.id = comments.pick_id
      and p.status = 'active'
  )
);

create policy comments_delete_own
on public.comments
for delete
to authenticated
using (user_id = (select auth.uid()));

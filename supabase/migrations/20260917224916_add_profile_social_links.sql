create table public.profile_social_links (
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram','youtube','x','threads','naver_blog')),
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, platform),
  constraint profile_social_links_valid_url check (
    char_length(url) between 1 and 512 and url !~ '[[:space:][:cntrl:]]' and
    case platform
      when 'instagram' then url ~ '^https://www[.]instagram[.]com/[A-Za-z0-9._]{1,30}$'
      when 'youtube' then url ~ '^https://www[.]youtube[.]com/(@[A-Za-z0-9가-힣_.-]{3,30}|channel/UC[A-Za-z0-9_-]{22})$'
      when 'x' then url ~ '^https://x[.]com/[A-Za-z0-9_]{1,15}$'
      when 'threads' then url ~ '^https://www[.]threads[.]com/@[A-Za-z0-9._]{1,30}$'
      when 'naver_blog' then url ~ '^https://blog[.]naver[.]com/[A-Za-z0-9_-]{2,30}$'
      else false
    end
  )
);
comment on table public.profile_social_links is 'Optional public profile links, not verified SNS accounts or OAuth credentials. One link per supported platform.';
alter table public.profile_social_links enable row level security;
revoke all on public.profile_social_links from anon, authenticated;
grant select on public.profile_social_links to anon, authenticated;
grant insert (user_id, platform, url), update (user_id, platform, url), delete on public.profile_social_links to authenticated;
grant all on public.profile_social_links to service_role;
create policy profile_social_links_read on public.profile_social_links for select to anon, authenticated
using (exists (select 1 from public.profiles p where p.id = profile_social_links.user_id));
create policy profile_social_links_insert_own on public.profile_social_links for insert to authenticated
with check (user_id = (select auth.uid()) and not public.user_is_suspended((select auth.uid())));
create policy profile_social_links_update_own on public.profile_social_links for update to authenticated
using (user_id = (select auth.uid()) and not public.user_is_suspended((select auth.uid())))
with check (user_id = (select auth.uid()) and not public.user_is_suspended((select auth.uid())));
create policy profile_social_links_delete_own on public.profile_social_links for delete to authenticated
using (user_id = (select auth.uid()));
create trigger profile_social_links_set_updated_at before update on public.profile_social_links
for each row execute function private.set_updated_at();

-- Attribution is derived from the stored image pair, never items.created_by or
-- a client-supplied contributor ID. Existing images are intentionally NOT backfilled.
create table public.item_photo_credits (
  item_id uuid primary key references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  image_path text not null,
  thumbnail_path text not null,
  image_source_url text,
  created_at timestamptz not null default now()
);
create index item_photo_credits_user_id_idx on public.item_photo_credits(user_id);
alter table public.item_photo_credits enable row level security;
revoke all on public.item_photo_credits from public, anon, authenticated;
grant select on public.item_photo_credits to anon, authenticated;
grant all on public.item_photo_credits to service_role;
create policy item_photo_credits_visible on public.item_photo_credits
for select to anon, authenticated using (
  exists (
    select 1 from public.items i
    where i.id = item_photo_credits.item_id and i.status in ('active','discontinued')
      and i.image_path = item_photo_credits.image_path
      and i.thumbnail_path = item_photo_credits.thumbnail_path
      and i.image_source_url is not distinct from item_photo_credits.image_source_url
  )
  and exists (
    select 1 from public.profiles p where p.id = item_photo_credits.user_id
      and not public.user_is_suspended(p.id)
  )
);
comment on table public.item_photo_credits is
  'Server-derived credit for the currently adopted uploaded image. Not a claim of copyright ownership. No client writes or historical guesses.';

create function private.sync_item_photo_credit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  uploader uuid;
begin
  if tg_op = 'UPDATE' then
    if (new.image_path,new.thumbnail_path,new.image_source_url)
       is not distinct from (old.image_path,old.thumbnail_path,old.image_source_url) then
      return new;
    end if;
  end if;
  -- Removal, replacement, or a new external poster must not retain the old name.
  delete from public.item_photo_credits where item_id = new.id;
  if new.image_path is null or new.thumbnail_path is null then return new; end if;
  select p.id into uploader
  from storage.objects original
  join storage.objects thumb on thumb.bucket_id = 'item-photos'
    and thumb.name = new.thumbnail_path and thumb.owner_id = original.owner_id
  join public.profiles p on p.id::text = original.owner_id
  where original.bucket_id = 'item-photos' and original.name = new.image_path
    and original.name <> thumb.name
    and split_part(original.name,'/',1) = p.id::text
    and split_part(thumb.name,'/',1) = p.id::text
    and original.metadata->>'mimetype' = 'image/jpeg'
    and thumb.metadata->>'mimetype' = 'image/jpeg';
  if uploader is not null then
    insert into public.item_photo_credits(item_id,user_id,image_path,thumbnail_path,image_source_url)
    values(new.id,uploader,new.image_path,new.thumbnail_path,new.image_source_url);
  end if;
  return new;
end;
$$;
revoke all on function private.sync_item_photo_credit() from public, anon, authenticated;
create trigger sync_item_photo_credit
  after insert or update of image_path,thumbnail_path,image_source_url on public.items
  for each row execute function private.sync_item_photo_credit();

-- Caller RLS applies both to the credit row and to the profile join. Username
-- changes are reflected without a stale name snapshot; blocked/deleted users hide.
create function public.item_photo_credit(p_item_id uuid)
returns table(item_id uuid,user_id uuid,username text,image_path text,image_source_url text)
language sql stable security invoker set search_path = ''
as $$
  select credit.item_id,credit.user_id,p.username,credit.image_path,credit.image_source_url
  from public.item_photo_credits credit
  join public.profiles p on p.id = credit.user_id
  where credit.item_id = p_item_id;
$$;
revoke all on function public.item_photo_credit(uuid) from public;
grant execute on function public.item_photo_credit(uuid) to anon, authenticated, service_role;

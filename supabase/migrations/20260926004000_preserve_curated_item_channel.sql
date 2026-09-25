-- Security QA #289 item 5: a normal user's place-catalog reselection
-- must not replace a curated non-offline representative channel.

begin;

create or replace function private.preserve_curated_item_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- System/service writes and an AAL2 administrator may intentionally change
  -- representative channels. The guard is for ordinary caller-driven writes.
  if v_actor is null or private.is_admin_mfa() then
    return new;
  end if;

  -- Do not allow an ordinary caller path to demote an existing curated
  -- non-offline primary channel.
  if tg_op='UPDATE'
     and old.channel<>'offline'
     and old.is_primary
     and not new.is_primary
  then
    new.is_primary := true;
  end if;

  -- If a curated non-offline primary exists, an offline upsert may refresh its
  -- URL but cannot become primary. This also covers INSERT .. ON CONFLICT DO
  -- UPDATE because the trigger runs for the resulting UPDATE row.
  if new.channel='offline'
     and new.is_primary
     and exists (
       select 1
       from public.item_channels c
       where c.item_id=new.item_id
         and c.channel<>'offline'
         and c.is_primary
     )
  then
    new.is_primary := false;
  end if;

  return new;
end;
$$;

revoke all on function private.preserve_curated_item_channel()
  from public, anon, authenticated;

drop trigger if exists preserve_curated_item_channel on public.item_channels;
create trigger preserve_curated_item_channel
before insert or update on public.item_channels
for each row execute function private.preserve_curated_item_channel();

commit;

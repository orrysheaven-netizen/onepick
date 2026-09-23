-- Match [storage.buckets.item-photos] file_size_limit = "5MiB".
-- This supersedes the bucket-limit guidance in relax_item_photo_byte_limits.
-- Keep JPEG compression and the removal of historical 768 KiB / 96 KiB RPC caps.
do $$
begin
  update storage.buckets
  set file_size_limit = 5242880
  where id = 'item-photos';
  if not found then
    raise exception 'Required Storage bucket item-photos is missing';
  end if;
end;
$$;

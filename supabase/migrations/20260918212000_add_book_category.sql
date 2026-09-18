-- Add books only. ISBN-13 identifies the selected edition/format.
-- Covers remain user-contributed until per-image reuse rights are verified.
do $$
declare parent_id uuid;
begin
  select id into parent_id from public.categories where slug='content';
  if parent_id is null then raise exception 'CONTENT_CATEGORY_REQUIRED'; end if;
  insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(parent_id,'책','book','open',true,true,34)
    on conflict(slug) do nothing;
end;
$$;

-- Add drama only. Preserve current movies, content parent settings, and user choices.
-- TMDB TV series use external_source='tmdb_tv'; the existing namespace/ID unique
-- constraint separates them from movie source='tmdb', even if numeric IDs collide.
do $$
declare parent_id uuid;
begin
  select id into parent_id from public.categories where slug='content';
  if parent_id is null then raise exception 'CONTENT_CATEGORY_REQUIRED'; end if;
  insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(parent_id,'드라마','drama','open',true,true,32)
    on conflict(slug) do nothing; -- Never reopen an existing admin-disabled category.
end;
$$;

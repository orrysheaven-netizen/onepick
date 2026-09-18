-- Add games only. IGDB game IDs identify selectable game records.
-- Versions/editions with version_parent are excluded from provider search;
-- remakes, remasters and expansions remain separate when IGDB assigns a game ID.
do $$
declare parent_id uuid;
begin
  select id into parent_id from public.categories where slug='content';
  if parent_id is null then raise exception 'CONTENT_CATEGORY_REQUIRED'; end if;
  insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(parent_id,'게임','game','open',true,true,35)
    on conflict(slug) do nothing;
end;
$$;

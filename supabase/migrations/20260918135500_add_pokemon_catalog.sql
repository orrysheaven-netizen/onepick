-- Add a character parent and Pokémon child category.
-- PokéAPI species IDs are stored in items.external_id under external_source='pokeapi_species'.
do $$
declare character_id uuid;
begin
  select id into character_id from public.categories where slug='character';

  if character_id is null then
    insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(null,'캐릭터','character','open',true,false,50)
    returning id into character_id;
  end if;

  insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
  values(character_id,'포켓몬','pokemon','open',true,true,51)
  on conflict(slug) do nothing;
end;
$$;

insert into public.categories (name, slug, status, is_visible, is_pickable, sort_order, ranking_min_sample)
values ('먹을것', 'food', 'open', true, false, 10, 20)
on conflict (slug) do update
set name = excluded.name,
    status = 'open',
    is_visible = true,
    is_pickable = false,
    sort_order = 10;

update public.categories
set parent_id = (select id from public.categories where slug = 'food'),
    sort_order = 11
where slug = 'ramen';
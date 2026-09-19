begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- Standalone CI fixture only. The deployed database already has this parent.
insert into public.categories(name,slug,status,is_visible,is_pickable,sort_order)
values('먹을것','food','open',true,false,10) on conflict(slug) do nothing;
create temp table starter_before_categories as select id,to_jsonb(c) row_data from public.categories c;
create temp table starter_before_items as select id,to_jsonb(i) row_data from public.items i;
create temp table starter_before_users as select
  (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.picks p) picks,
  (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.profile_ai_reviews r) reviews;

\ir ../operations/seed-general-categories.sql

select is((select count(*) from public.categories where slug in ('ice-cream','book','ballpoint-pen','notebook') and is_visible and is_pickable and status='open'),4::bigint,'Four new ordinary leaf categories are open');
select is((select count(*) from public.categories where slug in ('reading','daily-use') and parent_id is null and not is_pickable and is_visible),2::bigint,'New group rows are not pickable');
select ok(not exists(select 1 from public.categories c join public.categories p on p.id=c.parent_id where c.slug in ('ice-cream','book','ballpoint-pen','notebook') and p.slug<>case c.slug when 'ice-cream' then 'food' when 'book' then 'reading' else 'daily-use' end),'Leaf categories use the intended parent');
select is((select count(*) from public.items where external_source='onepick_starter'),8::bigint,'Eight catalog entries, not user Picks');
select is((select count(*) from public.items where external_source='onepick_starter' and status='active' and official_url like 'https://%' and image_path is null and thumbnail_path is null and image_source_url is null),8::bigint,'Every entry has an official link and no copied image');
select is((select count(*) from public.items i join public.categories c on c.id=i.category_id where c.slug='book' and i.external_source='onepick_starter' and i.model_code in ('9788937460449','9788949140865')),2::bigint,'Book edition ISBNs are preserved');
select ok(not exists(select 1 from starter_before_categories b left join public.categories c on c.id=b.id where to_jsonb(c) is distinct from b.row_data),'Existing categories are unchanged');
select ok(not exists(select 1 from starter_before_items b left join public.items i on i.id=b.id where to_jsonb(i) is distinct from b.row_data),'Existing items are unchanged');
select ok((select picks from starter_before_users)=(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.picks p),'User Picks are unchanged');
select ok((select reviews from starter_before_users)=(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.profile_ai_reviews r),'User AI reviews are unchanged');

create temp table starter_after as select
 (select jsonb_agg(to_jsonb(c) order by id) from public.categories c) categories,
 (select jsonb_agg(to_jsonb(i) order by id) from public.items i) items;
\ir ../operations/seed-general-categories.sql
select ok((select categories from starter_after)=(select jsonb_agg(to_jsonb(c) order by id) from public.categories c) and (select items from starter_after)=(select jsonb_agg(to_jsonb(i) order by id) from public.items i),'A second import creates no duplicates and changes no timestamps');

set local role anon;
select is((select count(*) from public.items where external_source='onepick_starter'),8::bigint,'Anonymous users can read the catalog through existing RLS');
select is((select count(*) from public.items i where i.external_source='onepick_starter' and exists(select 1 from public.search_items(i.name,array[i.category_id],20) s where coalesce(to_jsonb(s)->>'id',to_jsonb(s)->>'item_id')=i.id::text)),8::bigint,'Existing public search finds each candidate in its own category');
reset role;

-- Replays must not undo subsequent moderation or editorial changes.
update public.categories set is_visible=false,status='closed' where slug='notebook';
update public.items set name='검수 중인 노트',normalized_name='검수중인노트',status='hidden',official_url='https://example.test/operator-edit' where external_source='onepick_starter' and external_id='notebook-md-15384006';
\ir ../operations/seed-general-categories.sql
select ok((select not is_visible and status='closed' from public.categories where slug='notebook') and (select name='검수 중인 노트' and status='hidden' and official_url='https://example.test/operator-edit' from public.items where external_source='onepick_starter' and external_id='notebook-md-15384006'),'Replay never republishes a closed category or overwrites an edited item');
select * from finish();
rollback;

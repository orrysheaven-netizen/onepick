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

-- Supabase pg_prove mounts tests, not sibling operations. Inline the exact
-- operator statement once; the Node check below enforces byte-for-byte parity.
create function pg_temp.run_general_category_starter() returns void
language plpgsql as $test_runner$
begin
  execute $inline_starter_operation$
-- Explicit operator-run starter catalog. DML only; not an automatic migration.
-- A single DO statement is atomic. Replays never reopen or overwrite edited rows.
-- IDs are resolved by slug/curation key, never copied from a live database.
-- onepick_starter identifies our curated seed, NOT an external catalog API.
-- Source URLs/check date and rollout evidence: docs/ai-general-categories.md.
DO $seed$
declare
  spec record;
  entry jsonb;
  parent_row public.categories%rowtype;
  category_row public.categories%rowtype;
  existing_item public.items%rowtype;
  wanted_parent uuid;
  normalized text;
begin
  perform pg_advisory_xact_lock(hashtextextended('onepick-general-categories-v1',0));
  -- Share the category validator's lock rather than changing its permissions.
  perform pg_advisory_xact_lock(hashtextextended('category-tree',0));
  select * into parent_row from public.categories where slug='food';
  if not found or parent_row.parent_id is not null or parent_row.is_pickable
     or not parent_row.is_visible or parent_row.status <> 'open' then
    raise exception 'GENERAL_STARTER_FOOD_PARENT_NOT_READY';
  end if;

  for spec in select * from (values
    (1,'reading','읽을것',null::text,60,false),
    (2,'daily-use','쓰는것',null::text,70,false),
    (3,'ice-cream','아이스크림','food',12,true),
    (4,'book','책','reading',61,true),
    (5,'ballpoint-pen','볼펜','daily-use',71,true),
    (6,'notebook','노트','daily-use',72,true)
  ) as s(sequence,slug,name,parent_slug,sort_order,is_pickable) order by sequence loop
    wanted_parent := null;
    if spec.parent_slug is not null then
      select * into parent_row from public.categories where slug=spec.parent_slug;
      if not found or parent_row.is_pickable or parent_row.parent_id is not null then
        raise exception 'GENERAL_STARTER_PARENT_CONFLICT: %',spec.parent_slug;
      end if;
      wanted_parent := parent_row.id;
    end if;
    insert into public.categories(name,slug,parent_id,status,is_visible,is_pickable,sort_order)
    values(spec.name,spec.slug,wanted_parent,'open',true,spec.is_pickable,spec.sort_order)
    on conflict (slug) do nothing;
    select * into category_row from public.categories where slug=spec.slug;
    if category_row.parent_id is distinct from wanted_parent
       or category_row.is_pickable is distinct from spec.is_pickable
       or category_row.name is distinct from spec.name then
      raise exception 'GENERAL_STARTER_CATEGORY_CONFLICT: %',spec.slug;
    end if;
    -- Existing visibility/status/sort order are intentionally not overwritten.
  end loop;

  for entry in select value from jsonb_array_elements($catalog$
[
  {
    "key": "ice-cream-melona",
    "category": "ice-cream",
    "name": "메로나",
    "creator": "빙그레",
    "url": "https://www.bing.co.kr/product/list?type=1"
  },
  {
    "key": "ice-cream-together",
    "category": "ice-cream",
    "name": "투게더",
    "creator": "빙그레",
    "url": "https://www.bing.co.kr/product/list?type=1"
  },
  {
    "key": "book-isbn-9788937460449",
    "category": "book",
    "name": "데미안 (민음사 세계문학전집 44)",
    "creator": "헤르만 헤세",
    "model": "9788937460449",
    "original": "Demian",
    "year": 2000,
    "collection": "민음사 · 전영애 옮김",
    "url": "https://minumsa.minumsa.com/book/1713/"
  },
  {
    "key": "book-isbn-9788949140865",
    "category": "book",
    "name": "어린 왕자 (비룡소 클래식 14)",
    "creator": "생텍쥐페리",
    "model": "9788949140865",
    "original": "Le petit prince",
    "year": 2005,
    "collection": "비룡소 · 박성창 옮김",
    "url": "https://bir.co.kr/book/11741/"
  },
  {
    "key": "pen-monami-153-black-white",
    "category": "ballpoint-pen",
    "name": "모나미 153 블랙 & 화이트",
    "creator": "모나미",
    "url": "https://www.monami.com/product/product_view_20240612.php?ccode=005&idx=19"
  },
  {
    "key": "pen-monami-153-respect-refine",
    "category": "ballpoint-pen",
    "name": "모나미 153 리스펙트 리파인",
    "creator": "모나미",
    "original": "153 Respect Refine",
    "url": "https://www.monami.com/en/m/product/product_view.php?ccode=005001&idx=153"
  },
  {
    "key": "notebook-muji-4550002185053",
    "category": "notebook",
    "name": "무인양품 미표백 노트 A5",
    "creator": "MUJI",
    "model": "4550002185053",
    "original": "UNBLEACHED PAPER NOTEBOOK",
    "url": "https://www.muji.com/sg/products/cmdty/detail/4550002185053"
  },
  {
    "key": "notebook-md-15384006",
    "category": "notebook",
    "name": "MD 노트 A5 무지",
    "creator": "MD PRODUCT",
    "model": "15384006",
    "original": "MD Notebook A5 Blank",
    "url": "https://md-product.com/en/products/md-notebook-a5"
  }
]
$catalog$::jsonb) loop
    select * into category_row from public.categories where slug=entry->>'category';
    if not found or not category_row.is_pickable then
      raise exception 'GENERAL_STARTER_CATEGORY_MISSING';
    end if;
    select * into existing_item from public.items
      where external_source='onepick_starter' and external_id=entry->>'key';
    if found then
      if existing_item.category_id <> category_row.id then
        raise exception 'GENERAL_STARTER_IDENTITY_CONFLICT: %',entry->>'key';
      end if;
      continue; -- Preserve edits, moderation, external links and user photos.
    end if;
    normalized := regexp_replace(lower(entry->>'name'),'[[:space:]]+','','g');
    if exists(select 1 from public.items i where i.category_id=category_row.id
      and (i.normalized_name=normalized or
        ((entry->>'model') is not null and i.model_code=entry->>'model'))) then
      raise exception 'GENERAL_STARTER_EXISTING_ITEM_REQUIRES_REVIEW: %',entry->>'key';
    end if;
    insert into public.items(category_id,name,normalized_name,status,official_url,
      model_code,original_name,release_year,creator_name,collection_name,
      external_source,external_id)
    values(category_row.id,entry->>'name',normalized,'active',entry->>'url',
      entry->>'model',entry->>'original',(entry->>'year')::smallint,
      entry->>'creator',entry->>'collection','onepick_starter',entry->>'key');
    -- No profile, Pick, review, image, price, biography or copied marketing text.
  end loop;
end;
$seed$;
$inline_starter_operation$;
end;
$test_runner$;

select pg_temp.run_general_category_starter();

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
select pg_temp.run_general_category_starter();
select ok((select categories from starter_after)=(select jsonb_agg(to_jsonb(c) order by id) from public.categories c) and (select items from starter_after)=(select jsonb_agg(to_jsonb(i) order by id) from public.items i),'A second import creates no duplicates and changes no timestamps');

-- Measure under anonymous RLS, then report through pgTAP as the test owner.
-- Do not grant application roles access to pgTAP's private test-state tables.
do $public_checks$
declare readable_count bigint; searchable_count bigint;
begin
  set local role anon;
  select count(*) into readable_count from public.items where external_source='onepick_starter';
  select count(*) into searchable_count from public.items i
    where i.external_source='onepick_starter' and exists(
      select 1 from public.search_items(i.name,array[i.category_id],20) s
      where coalesce(to_jsonb(s)->>'id',to_jsonb(s)->>'item_id')=i.id::text);
  reset role;
  perform set_config('test.general_starter_readable',readable_count::text,true);
  perform set_config('test.general_starter_searchable',searchable_count::text,true);
end;
$public_checks$;
select is(current_setting('test.general_starter_readable')::bigint,8::bigint,'Anonymous users can read the catalog through existing RLS');
select is(current_setting('test.general_starter_searchable')::bigint,8::bigint,'Existing public search finds each candidate in its own category');

-- Replays must not undo subsequent moderation or editorial changes.
update public.categories set is_visible=false,status='closed' where slug='notebook';
update public.items set name='검수 중인 노트',normalized_name='검수중인노트',status='hidden',official_url='https://example.test/operator-edit' where external_source='onepick_starter' and external_id='notebook-md-15384006';
select pg_temp.run_general_category_starter();
select ok((select not is_visible and status='closed' from public.categories where slug='notebook') and (select name='검수 중인 노트' and status='hidden' and official_url='https://example.test/operator-edit' from public.items where external_source='onepick_starter' and external_id='notebook-md-15384006'),'Replay never republishes a closed category or overwrites an edited item');
select * from finish();
rollback;

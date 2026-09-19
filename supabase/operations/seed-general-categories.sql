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

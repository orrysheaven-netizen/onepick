begin;
create table if not exists public.category_search_terms (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  term text not null,
  kind text not null default 'tag' check (kind in ('alias','tag')),
  created_at timestamptz not null default now(),
  check (char_length(btrim(term)) between 1 and 60)
);
create unique index if not exists category_search_terms_category_term_key
on public.category_search_terms(category_id, lower(term));
create index if not exists category_search_terms_term_idx
on public.category_search_terms(lower(term));
alter table public.category_search_terms enable row level security;
drop policy if exists "category search terms readable" on public.category_search_terms;
create policy "category search terms readable" on public.category_search_terms for select to anon, authenticated using (true);
revoke insert,update,delete on public.category_search_terms from anon,authenticated;
grant select on public.category_search_terms to anon,authenticated;

with seed(category_slug,term,kind) as (values
 ('ramen','비빔면','tag'),('ramen','컵라면','tag'),('ramen','봉지라면','tag'),
 ('kimchi','배추김치','tag'),('kimchi','파김치','tag'),('kimchi','갓김치','tag'),('kimchi','포기김치','tag'),
 ('seaweed','곱창김','tag'),('seaweed','조미김','tag'),('seaweed','도시락김','tag'),
 ('shine-muscat','샤인머스켓','alias'),
 ('protein-drink','프로틴음료','alias'),('protein-drink','프로틴','alias'),
 ('olive-oil','올리브유','alias'),
 ('coffee-beans','커피원두','alias'),('coffee-beans','홀빈','alias'),
 ('tea','티백','tag'),
 ('jeotgal','명란젓','tag'),('jeotgal','명란','tag'),
 ('dumpling','냉동만두','tag'),('pizza','냉동피자','tag')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind from seed s join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;
commit;

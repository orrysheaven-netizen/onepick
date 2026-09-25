begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select throws_ok(
  $$insert into public.online_stores(store_type,host,platform,store_key,official_url)
    values('official_site','s.baemin.com',null,'site:s.baemin.com','https://s.baemin.com/store/1')$$,
  '23514', null,
  'A delivery-app subdomain cannot become an online store'
);

select throws_ok(
  $$insert into public.online_stores(store_type,host,platform,store_key,official_url)
    values('official_site','coupangeats.com',null,'site:coupangeats.com','https://coupangeats.com/')$$,
  '23514', null,
  'A delivery-app apex host cannot become an online store'
);

select lives_ok(
  $$insert into public.online_stores(store_type,host,platform,store_key,official_url)
    values('official_site','notbaemin.com',null,'site:notbaemin.com','https://notbaemin.com/')$$,
  'Only exact delivery hosts and their subdomains are blocked'
);

select * from finish();
rollback;

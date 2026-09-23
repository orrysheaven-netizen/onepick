begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select is(
  (select file_size_limit from storage.buckets where id = 'item-photos'),
  5242880::bigint,
  'item-photos enforces the configured 5 MiB Storage upload ceiling'
);

select * from finish();
rollback;

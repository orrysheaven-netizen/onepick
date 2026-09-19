-- Remove only the synthetic demo identities/profiles/Picks.
-- Catalog items are legitimate shared catalog records and are intentionally retained.

begin;

delete from auth.users
where id in (
  'd0e00001-1111-4111-8111-111111111111',
  'd0e00002-2222-4222-8222-222222222222',
  'd0e00003-3333-4333-8333-333333333333',
  'd0e00004-4444-4444-8444-444444444444',
  'd0e00005-5555-4555-8555-555555555555'
);

commit;

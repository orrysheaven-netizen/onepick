-- Delivery belongs to the 매장 (offline) channel: a delivery app sells one
-- store's food. Keep delivery-app hosts out of online_stores so they can never
-- become an 'online' item channel. Keep in sync with
-- mobile/src/lib/items/pickChannel.ts DELIVERY_APP_HOSTS.
--
-- NOT VALID: existing rows are left for admin review instead of failing the
-- migration; every new or updated row is checked.

begin;

alter table public.online_stores
  add constraint online_stores_not_delivery_app check (
    host !~ '(^|\.)(baemin\.com|coupangeats\.com|yogiyo\.co\.kr|ddangyo\.com)$'
  ) not valid;

commit;

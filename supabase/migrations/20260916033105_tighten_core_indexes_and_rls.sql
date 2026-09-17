create index categories_parent_id_idx on public.categories(parent_id);
create index picks_product_category_idx on public.picks(product_id, category_id);
create index picks_replaced_by_pick_id_idx on public.picks(replaced_by_pick_id);
create index products_created_by_idx on public.products(created_by);
create index products_merged_into_product_id_idx on public.products(merged_into_product_id);

drop policy if exists picks_public_active_read on public.picks;
drop policy if exists picks_self_history_read on public.picks;

create policy picks_anon_active_read on public.picks
for select to anon
using (status = 'active');

create policy picks_authenticated_read on public.picks
for select to authenticated
using (
  status = 'active'
  or (select auth.uid()) = user_id
);

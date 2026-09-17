drop policy if exists product_aliases_public_read on public.product_aliases;
drop policy if exists product_aliases_admin_read on public.product_aliases;

create policy product_aliases_anon_read
on public.product_aliases for select
to anon
using (
  exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.id = product_id
      and p.status in ('active', 'discontinued')
      and c.status = 'open'
      and c.is_visible = true
      and c.is_pickable = true
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status = 'open'
          and parent.is_visible = true
          and parent.is_pickable = false
        )
      )
  )
);

create policy product_aliases_authenticated_read
on public.product_aliases for select
to authenticated
using (
  (select private.is_admin((select auth.uid())))
  or exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.id = product_id
      and p.status in ('active', 'discontinued')
      and c.status = 'open'
      and c.is_visible = true
      and c.is_pickable = true
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status = 'open'
          and parent.is_visible = true
          and parent.is_pickable = false
        )
      )
  )
);

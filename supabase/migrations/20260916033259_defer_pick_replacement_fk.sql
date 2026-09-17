alter table public.picks
  drop constraint picks_replaced_by_pick_id_fkey;

alter table public.picks
  add constraint picks_replaced_by_pick_id_fkey
  foreign key (replaced_by_pick_id)
  references public.picks(id)
  on delete set null
  deferrable initially deferred;

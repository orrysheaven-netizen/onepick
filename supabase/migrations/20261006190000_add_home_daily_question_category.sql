begin;

alter table public.home_settings
  add column daily_question_category_id uuid null
    references public.categories(id) on delete set null;

grant update (daily_question_category_id) on public.home_settings to authenticated;

create function private.validate_home_daily_question_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.daily_question_category_id is not null
     and not (
       public.category_is_open_leaf(new.daily_question_category_id)
       and private.category_is_food(new.daily_question_category_id)
     ) then
    raise exception 'HOME_DAILY_QUESTION_CATEGORY_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_home_daily_question_category() from public, anon, authenticated;

create trigger home_settings_daily_question_category_valid
before insert or update of daily_question_category_id on public.home_settings
for each row execute function private.validate_home_daily_question_category();

commit;

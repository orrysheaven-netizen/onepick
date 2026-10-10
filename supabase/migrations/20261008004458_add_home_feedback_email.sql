begin;

-- Public contact address only; existing singleton SELECT and AAL2 admin UPDATE
-- policies remain authoritative. No mail provider or send capability is added.
alter table public.home_settings add column feedback_email text null
  constraint home_settings_feedback_email_valid check (
    feedback_email is null or (
      octet_length(feedback_email) <= 254
      and length(split_part(feedback_email, '@', 1)) <= 64
      and feedback_email ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
    )
  );

comment on column public.home_settings.feedback_email is
  'Public feedback recipient; NULL means unconfigured. Edited only by an AAL2 allowlisted administrator.';
grant update (feedback_email) on public.home_settings to authenticated;

commit;

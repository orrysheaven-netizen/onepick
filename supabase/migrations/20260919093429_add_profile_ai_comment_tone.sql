-- Tone is a server-authored presentation mode, never a user's MBTI type.
-- Legacy prompt versions deliberately map to NULL rather than invent a mode.
alter table public.profile_ai_reviews
  add column tone text generated always as (
    case
      when split_part(prompt_version, ':', 2) in ('direct', 'warm')
       and split_part(prompt_version, ':', 3) = 'tone-v1'
       and split_part(prompt_version, ':', 4) = ''
      then split_part(prompt_version, ':', 2)
      else null
    end
  ) stored;
comment on column public.profile_ai_reviews.tone is
  'Comment delivery style derived from server-only prompt_version: direct/warm; NULL for legacy. Not a personality attribute.';
-- Retain all existing row policies; grant only read access to the new field.
grant select (tone) on public.profile_ai_reviews to anon, authenticated;


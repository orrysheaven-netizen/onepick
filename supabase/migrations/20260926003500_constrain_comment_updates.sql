-- Security QA #289 item 2: comment edits may change body only.
-- Ownership, parent pick, row identity and timestamps remain server-owned.

begin;

revoke update on public.comments from authenticated;
grant update (body) on public.comments to authenticated;

commit;

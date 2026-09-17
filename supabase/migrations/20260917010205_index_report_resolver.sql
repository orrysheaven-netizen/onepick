create index content_reports_resolved_by_idx
on public.content_reports(resolved_by)
where resolved_by is not null;

-- Refs #225 (item 11): match the identifier alphabet used by the QA report.
-- Keep the existing lengths/nullability and use C collation for ASCII ranges.
-- NOT VALID skips historical rows during deployment, but immediately enforces
-- every new INSERT/UPDATE. Do not validate until legacy values are remediated.
alter table public.client_error_events
  add constraint client_error_events_context_identifier_check
    check ((context collate "C") ~ '^[A-Za-z0-9_:./-]{1,80}$') not valid,
  add constraint client_error_events_error_code_identifier_check
    check ((error_code collate "C") ~ '^[A-Za-z0-9_:./-]{1,80}$') not valid,
  add constraint client_error_events_platform_identifier_check
    check (platform is null or (platform collate "C") ~ '^[A-Za-z0-9_:./-]{1,24}$') not valid;

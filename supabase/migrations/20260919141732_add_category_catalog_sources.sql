create table public.category_catalog_sources (
  category_id uuid primary key references public.categories(id) on delete cascade,
  mode text not null check (mode in ('internal','external')),
  provider text,
  edge_function_slug text,
  external_source text,
  is_enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint category_catalog_sources_provider_check
    check (
      provider is null
      or provider ~ '^[a-z][a-z0-9_]{0,31}$'
    ),
  constraint category_catalog_sources_function_slug_check
    check (
      edge_function_slug is null
      or edge_function_slug ~ '^[a-z][a-z0-9-]{0,62}$'
    ),
  constraint category_catalog_sources_external_source_check
    check (
      external_source is null
      or external_source ~ '^[a-z][a-z0-9_]{0,31}$'
    ),
  constraint category_catalog_sources_notes_check
    check (
      notes is null
      or char_length(btrim(notes)) between 1 and 240
    ),
  constraint category_catalog_sources_mode_consistent
    check (
      (
        mode = 'internal'
        and provider is null
        and edge_function_slug is null
        and external_source is null
      )
      or
      (
        mode = 'external'
        and provider is not null
        and edge_function_slug is not null
        and external_source is not null
      )
    )
);

alter table public.category_catalog_sources enable row level security;

grant select on public.category_catalog_sources to anon, authenticated;
grant select, insert, update, delete on public.category_catalog_sources to service_role;
grant insert, update, delete on public.category_catalog_sources to authenticated;

create policy category_catalog_sources_public_read
on public.category_catalog_sources
for select
to anon, authenticated
using (true);

create policy category_catalog_sources_admin_insert
on public.category_catalog_sources
for insert
to authenticated
with check ((select private.is_admin_mfa()));

create policy category_catalog_sources_admin_update
on public.category_catalog_sources
for update
to authenticated
using ((select private.is_admin_mfa()))
with check ((select private.is_admin_mfa()));

create policy category_catalog_sources_admin_delete
on public.category_catalog_sources
for delete
to authenticated
using ((select private.is_admin_mfa()));

insert into public.category_catalog_sources (
  category_id, mode, provider, edge_function_slug, external_source, notes
)
select c.id, v.mode, v.provider, v.edge_function_slug, v.external_source, v.notes
from (
  values
    ('ramen',         'internal', null, null, null, 'OnePick master catalog'),
    ('ice-cream',     'internal', null, null, null, 'OnePick master catalog'),
    ('snacks',        'internal', null, null, null, 'OnePick master catalog'),
    ('notebook',      'internal', null, null, null, 'OnePick master catalog'),
    ('ballpoint-pen', 'internal', null, null, null, 'OnePick master catalog'),
    ('beer',          'internal', null, null, null, 'OnePick master catalog'),
    ('soju',          'internal', null, null, null, 'OnePick master catalog'),
    ('book',          'external', 'google_books', 'book-catalog', 'google_books_volume', 'Google Books volume catalog'),
    ('movie',         'external', 'tmdb', 'movie-catalog', 'tmdb', 'TMDB movie catalog'),
    ('drama',         'external', 'tmdb', 'movie-catalog', 'tmdb_tv', 'TMDB TV catalog'),
    ('music',         'external', 'musicbrainz', 'music-catalog', 'musicbrainz_recording', 'MusicBrainz recording catalog'),
    ('game',          'external', 'igdb', 'game-catalog', 'igdb_game', 'IGDB game catalog'),
    ('youtube',       'external', 'youtube', 'youtube-catalog', 'youtube_channel', 'YouTube channel catalog'),
    ('pokemon',       'external', 'pokeapi', 'pokemon-catalog', 'pokeapi_species', 'PokéAPI species catalog')
) as v(category_slug, mode, provider, edge_function_slug, external_source, notes)
join public.categories c on c.slug = v.category_slug
on conflict (category_id) do update
set
  mode = excluded.mode,
  provider = excluded.provider,
  edge_function_slug = excluded.edge_function_slug,
  external_source = excluded.external_source,
  notes = excluded.notes,
  updated_at = now();


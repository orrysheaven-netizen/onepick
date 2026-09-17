export const TMDB_SOURCE = 'tmdb' as const;
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w342';

export type TmdbMovie = {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  adult?: boolean;
};

export type MovieCatalogEntry = {
  source: typeof TMDB_SOURCE;
  externalId: string;
  title: string;
  originalTitle: string | null;
  releaseYear: number | null;
  posterUrl: string | null;
  existingItemId: string | null;
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

export function tmdbPosterUrl(path: unknown) {
  return typeof path === 'string' && /^\/[A-Za-z0-9._-]+$/.test(path)
    ? `${TMDB_IMAGE_BASE_URL}${path}`
    : null;
}

export function releaseYear(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}(?:-|$)/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  return year >= 1888 && year <= 2200 ? year : null;
}

export function mapTmdbMovie(movie: TmdbMovie): MovieCatalogEntry | null {
  if (!Number.isSafeInteger(movie.id) || Number(movie.id) <= 0 || movie.adult === true) return null;
  const title = cleanText(movie.title, 100) || cleanText(movie.original_title, 100);
  if (!title) return null;
  const originalTitle = cleanText(movie.original_title, 200);
  return {
    source: TMDB_SOURCE,
    externalId: String(movie.id),
    title,
    originalTitle: originalTitle || null,
    releaseYear: releaseYear(movie.release_date),
    posterUrl: tmdbPosterUrl(movie.poster_path),
    existingItemId: null,
  };
}

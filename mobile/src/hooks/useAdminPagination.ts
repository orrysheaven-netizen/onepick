import { useCallback, useEffect, useRef, useState } from 'react';

type FetchPage<T> = (offset: number) => Promise<T[]>;

// Shared offset-pagination state machine for the admin screens (audit/items/pending/reports
// all had their own hand-written copy of this before). `fetchPage` is read through a ref kept
// current by an effect (not assigned during render, which the project's React Compiler lint
// rules disallow) so callers don't need to memoize it beyond the deps their own closure needs.
export function useAdminPagination<T>(
  pageSize: number,
  fetchPage: FetchPage<T>,
  messages: { load?: string; loadMore?: string } = {},
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  // Bumped on every load() and on every removeWhere(). loadMore()'s offset is `items.length`
  // captured at call time; if the list is replaced or has a row removed for any other reason
  // while that request is in flight, the offset no longer lines up with the current list, so
  // the page is discarded instead of being appended -- the next "더 보기" tap retries with a
  // fresh offset.
  const version = useRef(0);

  // Returns the fetched page on success so a caller that needs to react to the fresh result
  // (e.g. picking a selection) doesn't have to read `items` back out of its own stale closure.
  const load = useCallback(async (override?: FetchPage<T>): Promise<T[] | undefined> => {
    setLoading(true);
    setError('');
    version.current += 1;
    try {
      const result = await (override ?? fetchRef.current)(0);
      setItems(result);
      setHasMore(result.length === pageSize);
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.load ?? '목록을 불러오지 못했습니다.');
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [pageSize, messages.load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError('');
    const versionAtRequest = version.current;
    try {
      const result = await fetchRef.current(items.length);
      if (version.current !== versionAtRequest) return;
      setItems((current) => [...current, ...result]);
      setHasMore(result.length === pageSize);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.loadMore ?? '더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, items.length, pageSize, messages.loadMore]);

  const removeWhere = useCallback((predicate: (item: T) => boolean) => {
    setItems((current) => current.filter((item) => !predicate(item)));
    version.current += 1;
  }, []);

  return { items, setItems, loading, loadingMore, hasMore, error, setError, load, loadMore, removeWhere };
}

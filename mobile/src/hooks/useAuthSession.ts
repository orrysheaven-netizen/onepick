import { useCallback, useEffect, useState } from 'react';

import { discardPickDraftForOtherUser } from '@/lib/pick/pickDraft';
import { authService } from '@/services';
import type { AuthUser } from '@/types/domain/auth';

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;

    const unsubscribe = authService.subscribe((nextUser) => {
      if (!active) return;
      receivedAuthEvent = true;
      // Signing in as another account discards the previous account's Pick draft.
      if (nextUser) discardPickDraftForOtherUser(nextUser.id);
      setUser(nextUser);
      setError(null);
      setIsLoading(false);
    });

    void (async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        if (!active || receivedAuthEvent) return;
        if (currentUser) discardPickDraftForOtherUser(currentUser.id);
        setUser(currentUser);
        setError(null);
        setIsLoading(false);
      } catch (cause) {
        if (!active || receivedAuthEvent) return;
        setUser(null);
        setError(cause ?? new Error('Session lookup failed'));
        setIsLoading(false);
      }
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);

  return {
    user,
    isLoading,
    error,
    retry,
  };
}

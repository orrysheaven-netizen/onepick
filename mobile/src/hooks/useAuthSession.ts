import { useEffect, useState } from 'react';

import { authService } from '@/services';
import type { AuthUser } from '@/types/domain/auth';

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void authService.getCurrentUser().then((currentUser) => {
      if (!active) return;
      setUser(currentUser);
      setIsLoading(false);
    });

    const unsubscribe = authService.subscribe((nextUser) => {
      if (!active) return;
      setUser(nextUser);
      setIsLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    user,
    isLoading,
  };
}

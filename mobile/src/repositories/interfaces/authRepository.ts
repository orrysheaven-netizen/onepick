import type { AuthUser } from '@/types/domain/auth';

export interface AuthRepository {
  getCurrentUser(): Promise<AuthUser | null>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signInWithKakao(redirectTo: string): Promise<AuthUser | null>;
  completeOAuthFromUrl(url: string): Promise<AuthUser | null>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

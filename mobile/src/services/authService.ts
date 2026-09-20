import type { AuthRepository } from '@/repositories/interfaces/authRepository';
import type { SocialAuthProvider } from '@/types/domain/auth';

export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  getCurrentUser() {
    return this.authRepository.getCurrentUser();
  }

  subscribe(listener: Parameters<AuthRepository['subscribe']>[0]) {
    return this.authRepository.subscribe(listener);
  }

  signInWithProvider(provider: SocialAuthProvider, redirectTo: string) {
    return this.authRepository.signInWithProvider(provider, redirectTo);
  }

  signInWithKakao(redirectTo: string) {
    return this.signInWithProvider('kakao', redirectTo);
  }

  completeOAuthFromUrl(url: string) {
    return this.authRepository.completeOAuthFromUrl(url);
  }

  signOut() {
    return this.authRepository.signOut();
  }

  deleteAccount() {
    return this.authRepository.deleteAccount();
  }
}

import type { AuthRepository } from '@/repositories/interfaces/authRepository';

export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  getCurrentUser() {
    return this.authRepository.getCurrentUser();
  }

  subscribe(listener: Parameters<AuthRepository['subscribe']>[0]) {
    return this.authRepository.subscribe(listener);
  }

  signInWithKakao(redirectTo: string) {
    return this.authRepository.signInWithKakao(redirectTo);
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

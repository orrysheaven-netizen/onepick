import type { User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { AuthRepository } from '@/repositories/interfaces/authRepository';
import type { AuthUser, SocialAuthProvider } from '@/types/domain/auth';

function mapAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
  };
}

function getUrlParam(url: string, key: string) {
  const parsed = new URL(url);
  const queryValue = parsed.searchParams.get(key);

  if (queryValue) return queryValue;

  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  return new URLSearchParams(hash).get(key);
}

const OAUTH_PROVIDER: Record<SocialAuthProvider, 'kakao' | 'google' | 'custom:naver'> = {
  kakao: 'kakao',
  google: 'google',
  naver: 'custom:naver',
};

export class SupabaseAuthRepository implements AuthRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async getCurrentUser() {
    const {
      data: { session },
      error,
    } = await this.client.auth.getSession();

    if (error) {
      throw new AppError('AUTH_FAILED', error.message, error);
    }

    return session?.user ? mapAuthUser(session.user) : null;
  }

  subscribe(listener: (user: AuthUser | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(session?.user ? mapAuthUser(session.user) : null);
    });

    return () => data.subscription.unsubscribe();
  }

  async completeOAuthFromUrl(url: string) {
    const errorDescription = getUrlParam(url, 'error_description');
    const errorCode = getUrlParam(url, 'error');

    if (errorDescription || errorCode) {
      throw new AppError('AUTH_FAILED', errorDescription ?? errorCode ?? 'AUTH_FAILED');
    }

    const code = getUrlParam(url, 'code');

    if (code) {
      const { data, error } = await this.client.auth.exchangeCodeForSession(code);

      if (error) {
        throw new AppError('AUTH_FAILED', error.message, error);
      }

      return data.user ? mapAuthUser(data.user) : null;
    }

    const accessToken = getUrlParam(url, 'access_token');
    const refreshToken = getUrlParam(url, 'refresh_token');

    if (!accessToken || !refreshToken) {
      throw new AppError('AUTH_FAILED');
    }

    const { data, error } = await this.client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      throw new AppError('AUTH_FAILED', error.message, error);
    }

    return data.user ? mapAuthUser(data.user) : null;
  }

  async signInWithProvider(provider: SocialAuthProvider, redirectTo: string) {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: OAUTH_PROVIDER[provider],
      options: {
        redirectTo,
        ...(provider === 'kakao'
          ? {
              // Keep the existing privacy-minimal Kakao scope. Google and Naver
              // use the scopes configured on their Supabase Auth providers.
              queryParams: { scope: 'profile_nickname' },
            }
          : {}),
        // Web uses a same-tab redirect; embedded browsers may not support popups.
        skipBrowserRedirect: Platform.OS !== 'web',
      },
    });

    if (error || !data.url) {
      throw new AppError('AUTH_FAILED', error?.message ?? 'AUTH_FAILED', error);
    }

    // The callback screen completes the session after the browser navigation.
    if (Platform.OS === 'web') return null;

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type !== 'success') {
      return null;
    }

    return this.completeOAuthFromUrl(result.url);
  }

  signInWithKakao(redirectTo: string) {
    return this.signInWithProvider('kakao', redirectTo);
  }

  async signOut() {
    const { error } = await this.client.auth.signOut({ scope: 'local' });

    if (error) {
      throw new AppError('AUTH_FAILED', error.message, error);
    }
  }

  async deleteAccount() {
    const { data, error } = await this.client.functions.invoke('delete-account', {
      body: {},
    });

    if (error || data?.ok !== true) {
      throw new AppError(
        'ACCOUNT_DELETE_FAILED',
        data?.code ?? error?.message ?? 'ACCOUNT_DELETE_FAILED',
        error ?? data,
      );
    }

    // The server has already removed the Auth user. This call only clears the
    // locally persisted session and should not change the deletion result.
    await this.client.auth.signOut({ scope: 'local' });
  }
}

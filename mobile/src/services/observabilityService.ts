import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { AppError } from '@/errors/appError';
import type { ObservabilityRepository } from '@/repositories/interfaces/observabilityRepository';

export class ObservabilityService {
  constructor(private readonly repository: ObservabilityRepository) {}

  async captureError(error: unknown, context: string) {
    const safeContext = context.trim().slice(0, 80) || 'unknown';
    const errorCode = error instanceof AppError ? error.code : 'UNEXPECTED_ERROR';

    if (process.env.NODE_ENV !== 'production') {
      console.error(`[OnePick:${safeContext}]`, error);
    }

    try {
      await this.repository.captureClientError({
        context: safeContext,
        errorCode,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? null,
      });
    } catch (captureError) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[OnePick:observability_capture_failed]', captureError);
      }
    }
  }
}

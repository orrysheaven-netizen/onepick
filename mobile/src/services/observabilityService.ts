import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { AppError } from '@/errors/appError';
import type {
  CaptureProductEventInput,
  ObservabilityRepository,
} from '@/repositories/interfaces/observabilityRepository';

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

  async captureProductEvent(input: Omit<CaptureProductEventInput, 'platform' | 'appVersion'>) {
    const source = input.source?.trim().slice(0, 40) || null;
    const path = input.path?.trim().slice(0, 160) || null;

    try {
      await this.repository.captureProductEvent({
        ...input,
        source,
        path,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? null,
      });
    } catch (captureError) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[OnePick:product_event_capture_failed]', input.eventName, captureError);
      }
    }
  }
}

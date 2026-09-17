export interface CaptureClientErrorInput {
  context: string;
  errorCode: string;
  platform?: string | null;
  appVersion?: string | null;
}

export interface ObservabilityRepository {
  captureClientError(input: CaptureClientErrorInput): Promise<void>;
}

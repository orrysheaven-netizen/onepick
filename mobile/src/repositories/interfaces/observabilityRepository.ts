export interface CaptureClientErrorInput {
  context: string;
  errorCode: string;
  platform?: string | null;
  appVersion?: string | null;
}

export type ProductEventName =
  | 'pick_created'
  | 'pick_share_clicked'
  | 'pick_link_opened'
  | 'item_detail_viewed'
  | 'auth_started'
  | 'auth_completed';

export interface CaptureProductEventInput {
  eventName: ProductEventName;
  pickId?: string | null;
  itemId?: string | null;
  categoryId?: string | null;
  source?: string | null;
  path?: string | null;
  platform?: string | null;
  appVersion?: string | null;
}

export interface ObservabilityRepository {
  captureClientError(input: CaptureClientErrorInput): Promise<void>;
  captureProductEvent(input: CaptureProductEventInput): Promise<void>;
}

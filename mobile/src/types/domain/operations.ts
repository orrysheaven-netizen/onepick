export interface AdminOperationsMetrics {
  profiles: number;
  activePicks: number;
  comments: number;
  activeItems: number;
  pendingItems: number;
  openReports: number;
}

export interface AdminProductFunnel {
  days: number;
  pickCreated: number;
  pickShareClicked: number;
  pickLinkOpened: number;
  itemDetailViewed: number;
  authStarted: number;
  authCompleted: number;
}

export interface AdminOperationsSnapshot {
  metrics: AdminOperationsMetrics;
  funnel: AdminProductFunnel;
  generatedAt: string;
}

export interface AdminAuditLog {
  id: string;
  actorUserId: string | null;
  entityType: 'category' | 'brand' | 'item' | 'content_report';
  entityId: string;
  action: 'insert' | 'update' | 'delete';
  summary: Record<string, unknown>;
  createdAt: string;
}

export interface ClientErrorEvent {
  id: string;
  userId: string | null;
  context: string;
  errorCode: string;
  platform: string | null;
  appVersion: string | null;
  createdAt: string;
}

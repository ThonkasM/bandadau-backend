/** Per-request data every downstream call carries. */
export interface CallContext {
  actorId?: string;
  locale: string;
  correlationId: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface IdentityUser {
  id: string;
  email: string;
  universityId: string;
  status: string;
  roles: string[];
  locale: 'es' | 'en';
  theme: 'SYSTEM' | 'LIGHT' | 'DARK';
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Identity contract 1.4.0: present while the account is suspended. */
  suspendedAt?: string | null;
  suspensionReason?: string | null;
}

export interface IdentityMcpToken {
  id: string;
  accessToken: string;
  audience: string;
  scopes: string[];
  label: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface IdentityUniversity {
  id: string;
  name: string;
  allowedDomains: string[];
  enabled: boolean;
  createdAt?: string;
}

export interface SocialProfile {
  userId: string;
  displayName: string;
  career?: string | null;
  semester?: number | null;
  avatarUrl?: string | null;
}

export interface MediaModerationResult {
  model: string;
  modelVersion: string;
  labels: string[];
  scores: Record<string, number>;
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
  createdAt: string;
}

export interface ModeratedMedia {
  id: string;
  ownerId: string;
  kind: 'IMAGE' | 'VIDEO';
  purpose: string;
  status: string;
  url: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  ocrText: string | null;
  createdAt: string;
  updatedAt: string;
  moderationResults: MediaModerationResult[];
}

export interface MediaUrl {
  mediaId: string;
  kind: string;
  purpose: string;
  status: string;
  url: string | null;
  thumbnailUrl: string | null;
}

export interface ModerationPost {
  id: string;
  authorId: string;
  author?: { userId: string; displayName: string; avatarUrl: string | null };
  text: string;
  hashtags: string[];
  visibility: string;
  status: string;
  media: { mediaId: string; kind: string; status: string; url: string | null; thumbnailUrl: string | null }[];
  reportsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SocialReport {
  id: string;
  targetType: 'POST' | 'COMMENT';
  targetId: string;
  reporterId: string;
  reason: string;
  details: string | null;
  status: string;
  resolution: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ContentDailyStats {
  from: string;
  to: string;
  days: { date: string; postsCreated: number; commentsCreated: number; reactionsSet: number; followsCreated: number; activeAuthors: number; postsHidden: number }[];
}

export interface EventDto {
  id: string;
  organizerId: string;
  title: string;
  description?: string;
  coverUrl: string | null;
  startsAt: string;
  venue: string;
  capacity: number;
  seatsTaken: number;
  priceCredits: number;
  status: string;
  createdAt: string;
}

export interface RegistrationDto {
  id: string;
  eventId: string;
  userId: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SagaDto {
  id: string;
  type: string;
  registrationId: string;
  eventId: string;
  userId: string;
  step: string;
  status: string;
  failureReason: string | null;
  retries: number;
  deadlineAt: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface RegistrationStats {
  from: string;
  to: string;
  groupBy: string;
  totals: { pending: number; confirmed: number; failed: number; cancelled: number; creditsCollected: number; creditsRefunded: number };
  series: { key: string; label: string; confirmed: number; failed: number; cancelled: number; pending: number }[];
}

export interface CreditStats {
  from: string;
  to: string;
  groupBy: string;
  totals: {
    topUpCount: number;
    topUpCredits: number;
    debitCount: number;
    debitCredits: number;
    refundCount: number;
    refundCredits: number;
    netCredits: number;
    circulatingCredits?: number;
  };
  series: { date: string; topUpCredits: number; debitCredits: number; refundCredits: number }[];
}

export interface InsightsReportDto {
  id: string;
  title: string | null;
  question: string;
  locale: 'es' | 'en';
  status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED';
  requestedBy: string;
  agentRunId: string | null;
  hasAudio: boolean;
  createdAt: string;
  completedAt: string | null;
  markdown?: string | null;
  dataset?: unknown;
  chart?: unknown;
  audioUrl?: string | null;
  audioDurationSeconds?: number | null;
  failureReason?: string | null;
}

export interface InsightsAlertDto {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  kind: string;
  message: string;
  details?: Record<string, unknown>;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  source: string;
  agentRunId: string | null;
  raisedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resource?: string | null;
  occurrences?: number;
}

export interface InsightsAgentRunDto {
  id: string;
  agent: 'MONITORING' | 'REPORT' | 'EXTERNAL_MCP';
  trigger: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED';
  model?: string | null;
  toolsUsed: string[];
  tokens?: { input: number; output: number; total: number };
  reportId: string | null;
  alertIds: string[];
  error: string | null;
  stopReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps?: { index: number; kind: string; toolName: string | null; input: unknown; outputSummary: string | null; isError: boolean; startedAt: string; durationMs: number }[];
}

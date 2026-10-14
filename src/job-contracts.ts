import type { GameSpec, GenerationAttempt } from './contracts.ts';
export type JobStage = 'queued'|'generating'|'validating'|'repairing'|'completed'|'needs_attention'|'cancelled'|'failed';
export interface GenerationJob {
  jobId: string; ownerId: string; idempotencyKey: string;
  spec: GameSpec; mode: 'demo'|'live'; previousVersionId?: string;
  provider: string|null; requestedModel: string|null; actualModel: string|null;
  createdAt: string; updatedAt: string; stage: JobStage; attempts: number;
  checkpoint: string; checkpointAt: string|null; history: GenerationAttempt[];
  errorCode: string|null; retryAt: number|null; versionId: string|null; gameId: string|null;
  notificationClaimed: boolean; telegramConsent: boolean; telegramState: 'none'|'pending'|'sent'|'unavailable'|'unknown';
  outputTokens: number|null; reasoningTokens: number|null; elapsedMs: number;
  recoveryState?:'retry_scheduled'|'waiting_for_provider'|'failed_permanent';
  checkpointOrigin?:{provider:string;requestedModel:string;model:string};
  routeCooldowns?:Record<string,{until:number;code:string}>;
  automaticRuns?:number; automaticLimit?:number; deadlineAt?:number; blockedRoutes?:string[];
}
export type JobSummary = Omit<GenerationJob,'checkpoint'|'ownerId'|'idempotencyKey'> & {checkpointBytes:number};

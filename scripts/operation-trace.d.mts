export type OperationStatus = 'STARTED' | 'PASS' | 'FAIL' | 'SKIPPED';
export declare function operationId(env?: NodeJS.ProcessEnv): string;
export declare class OperationTrace {
  constructor(options?: { dataRoot?: string; operationId?: string; clock?: () => number });
  readonly id: string;
  readonly available: boolean;
  record(stage: string, event: string, status: OperationStatus, data?: { durationMs?: number; errorCode?: string | null; details?: Record<string, unknown>; jobId?: string }): boolean;
  begin(stage: string, event: string, details?: Record<string, unknown>): (status?: OperationStatus, errorCode?: string | null, details?: Record<string, unknown>) => boolean;
  linkJob(jobId: string): boolean;
}

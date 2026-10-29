export declare class InstallError extends Error { code: string; constructor(code: string); }
export declare function runInstallation(adapter: any, notify?: (row: { stage: string; code: string }) => void, trace?: { record(stage: string, event: string, status: string, data?: Record<string, unknown>): boolean }): Promise<any>;

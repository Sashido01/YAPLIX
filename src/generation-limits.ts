// Shared by pure metadata validators and server timeout policy. No dependencies.
// One 30-minute response plus up to three serial repairs and their validation.
// The bounded durable job window leaves 10 minutes for queueing, validation,
// persistence and UI notification after the four response windows.
export const LIVE_JOB_TIMEOUT_MS=130*60_000;
export const SINGLE_POST_JOB_TIMEOUT_MS=35*60_000;

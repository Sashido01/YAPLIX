import { configuredGenerator } from '../src/live.ts';
import { CloudTransport } from '../src/transport.ts';
import { Fault } from '../src/contracts.ts';

// Service GETs only: no generation engine, workers, SQLite or inference POSTs.
try {
  const engine = configuredGenerator(process.argv.includes('--all')?{...process.env,LIVE_PROVIDER:'auto'}:process.env);
  const routes = engine?.routesFor();
  if (!routes?.length) throw new Fault('LLM_NOT_CONFIGURED');
  for (const route of routes) {
    if (!(route instanceof CloudTransport)) continue;
    const result = await route.diagnose(AbortSignal.timeout(10000));
    console.log(JSON.stringify({ provider: route.provider, model: route.model, ...result }));
    if (result.state !== 'ready') process.exitCode = 1;
  }
} catch (error) {
  console.log(JSON.stringify({ category: error instanceof Fault ? error.code : 'LLM_NETWORK_UNAVAILABLE', inferenceVerified: false }));
  process.exitCode = 1;
}

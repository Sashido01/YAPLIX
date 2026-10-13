import { lanAddresses, persistentLanKey, checkHost, checkPort } from '../src/network.ts';
import { networkPolicy } from '../src/access.ts';
import { Fault } from '../src/contracts.ts';

const args = process.argv.slice(2), addresses = lanAddresses();
try {
  console.log('Доступные LAN IPv4 (выберите Wi-Fi/Ethernet; VPN/виртуальные сети не подходят телефону):');
  for (const entry of addresses) console.log(`  ${entry.name}: ${entry.address}`);
  if (args.length === 1 && args[0] === '--list') process.exit(0);
  if (!args.length) { console.log('Запуск: npm run lan -- --host <выбранный IPv4> --port 3000'); process.exit(1); }
  if (args.length % 2 || args.some((value, i) => i % 2 === 0 && !['--host', '--port'].includes(value)) || new Set(args.filter((_, i) => i % 2 === 0)).size !== args.length / 2 || !args.includes('--host')) throw new Fault('LAN_ARGUMENTS_INVALID');
  process.env.YAPLIX_MODE = 'lan'; process.env.YAPLIX_HOST = args[args.indexOf('--host') + 1];
  if (args.includes('--port')) process.env.PORT = args[args.indexOf('--port') + 1];
  delete process.env.PUBLIC_URL;
  process.env.YAPLIX_ACCESS_KEY = persistentLanKey();
  const policy = networkPolicy(); checkHost(policy); await checkPort(policy);
  process.env.YAPLIX_PRINT_LAN_KEY = '1';
  await import('../src/server.ts');
} catch (error) {
  console.error(error instanceof Fault ? error.code : 'LAN_START_FAILED');
  console.error('Проверьте выбранный IPv4 и порт. PORT_IN_USE: остановите свой прежний сервер или выберите другой порт. Firewall автоматически не меняется.');
  process.exitCode = 1;
}

const scenario = process.argv[2];
if (scenario === 'exit') {
  process.stderr.write('DNS_FAILURE; Authorization: Bearer synthetic-secret-value\n');
  process.exitCode = 17;
} else if (scenario === 'split-secret') {
  process.stderr.write('token=synthetic-');
  setTimeout(() => { process.stderr.write('secret-value\n'); process.exit(19); }, 20);
} else if (scenario === 'url-exit') {
  process.stdout.write('https://synthetic-tunnel.trycloudflare.com\n');
  process.stderr.write('CONNECTION_CLOSED_AFTER_URL\n');
  process.exitCode = 23;
} else {
  if (scenario !== 'silent') process.stdout.write('https://synthetic-tunnel.trycloudflare.com\n');
  setInterval(() => {}, 1000);
}

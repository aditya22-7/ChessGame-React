const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Generates a future schedule; it does not create a tournament until the server
// is started with TOURNAMENT_CONFIG_FILE pointing to the generated file.
const filename = path.resolve(process.argv[2] ?? 'tournaments.local.json');
const now = Date.now();
const config = [{
  key: randomUUID(), name: 'Chess Olympics — Swiss', format: 'SWISS',
  registrationClosesAt: now + 20 * 60 * 1000,
  firstRoundStartsAt: now + 30 * 60 * 1000,
  totalRounds: 3, matchDurationMs: 10 * 60 * 1000,
  interRoundGapMs: 60 * 1000, reconnectGraceMs: 60 * 1000, maxEntrants: 256,
}];
fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
console.log('Created tournament configuration:', filename);

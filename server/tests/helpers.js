const { MemoryStore } = require('../persistence/store');
const { TournamentService } = require('../tournaments/service');
function fixture(count = 8, rounds = 3, options = {}) {
  let time = 1000;
  const store = options.store ?? new MemoryStore();
  const service = new TournamentService({ store, clock: () => time });
  const tournament = service.create({ name: 'Test tournament', registrationClosesAt: 2000,
    firstRoundStartsAt: 3000, totalRounds: rounds, matchDurationMs: 10000,
    interRoundGapMs: 1000, reconnectGraceMs: 1000, ...options.config });
  const players = Array.from({ length: count }, (_, i) => 'p' + i);
  players.forEach(p => service.register(tournament.id, p));
  const setTime = value => { time = value; };
  const raw = () => store.read(s => s.tournaments[tournament.id]);
  const owner = entrantId => raw().entrants.find(e => e.id === entrantId).playerId;
  const prepare = () => { setTime(2000); service.tick(); return raw().rounds[0]; };
  const joinRound = number => {
    const round = raw().rounds[number - 1];
    for (const m of round.matches) for (const side of ['white', 'black']) {
      const player = owner(m[side + 'EntrantId']);
      service.join(tournament.id, m.id, player, player + ':' + number);
    }
    return raw().rounds[number - 1];
  };
  const start = () => { prepare(); joinRound(1); setTime(3000); service.tick(); return raw().rounds[0]; };
  return { store, service, tournament, players, setTime, raw, owner, prepare, joinRound, start };
}
module.exports = { fixture };

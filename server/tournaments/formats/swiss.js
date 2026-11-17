const { DomainError, requireThat } = require('../errors');

const allowedColor = (p, color) => !(p.colors.length >= 2 && p.colors.slice(-2).every(c => c === color));
function colorCost(p, color) {
  const balance = p.colors.reduce((v, c) => v + (c === 'white' ? 1 : -1), 0);
  return Math.abs(balance + (color === 'white' ? 1 : -1)) * 2 + (p.colors.at(-1) === color ? 1 : 0);
}
function orientations(a, b) {
  return [[a, b], [b, a]].filter(([w, bl]) => allowedColor(w, 'white') && allowedColor(bl, 'black'))
    .sort((x, y) => colorCost(x[0], 'white') + colorCost(x[1], 'black') -
      colorCost(y[0], 'white') - colorCost(y[1], 'black') || x[0].seed - y[0].seed);
}
function validate(players, proposal) {
  const byId = new Map(players.map(p => [p.id, p]));
  const used = new Set();
  for (const pair of proposal.matches) {
    const w = byId.get(pair.white), b = byId.get(pair.black);
    requireThat(w && b && w !== b && !used.has(w.id) && !used.has(b.id), 'INVALID_PAIRING', 'Duplicate or unknown entrant');
    requireThat(!w.opponents.includes(b.id) && !b.opponents.includes(w.id), 'INVALID_PAIRING', 'Repeated opponent');
    requireThat(allowedColor(w, 'white') && allowedColor(b, 'black'), 'INVALID_PAIRING', 'Third consecutive color');
    used.add(w.id); used.add(b.id);
  }
  if (proposal.bye) {
    requireThat(byId.has(proposal.bye) && !used.has(proposal.bye) && !byId.get(proposal.bye).fullPointUnplayed,
      'INVALID_PAIRING', 'Ineligible bye');
    used.add(proposal.bye);
  }
  requireThat(used.size === players.length, 'INVALID_PAIRING', 'Incomplete allocation');
}

class SwissFormat {
  constructor({ searchLimit = 100000 } = {}) { this.searchLimit = searchLimit; this.version = 'custom-swiss-1'; }
  generateRound(players) {
    const ordered = [...players].sort((a, b) => b.score - a.score || a.seed - b.seed);
    const byes = ordered.length % 2 ? ordered.filter(p => !p.fullPointUnplayed)
      .sort((a, b) => a.score - b.score || (b.rankIndex ?? b.seed) - (a.rankIndex ?? a.seed)) : [null];
    let visited = 0;
    const preferred = new Map();
    // Split each score bracket in halves. Subsequent candidate swaps/floats
    // backtrack across brackets rather than committing a greedy dead end.
    const search = remaining => {
      if (++visited > this.searchLimit) throw new DomainError('SEARCH_LIMIT_REACHED', 'Swiss search budget exceeded');
      if (!remaining.length) return [];
      const [a, ...rest] = remaining;
      const candidates = rest.filter(b => !a.opponents.includes(b.id) && !b.opponents.includes(a.id))
        .sort((b, c) => Math.abs(a.score - b.score) - Math.abs(a.score - c.score) ||
          Number(preferred.get(a.id) !== b.id) - Number(preferred.get(a.id) !== c.id) || b.seed - c.seed);
      for (const b of candidates) {
        for (const [white, black] of orientations(a, b)) {
          const next = search(rest.filter(p => p.id !== b.id));
          if (next) return [{ white: white.id, black: black.id }, ...next];
        }
      }
      return null;
    };
    for (const bye of byes) {
      const field = ordered.filter(p => p !== bye);
      preferred.clear();
      for (const score of new Set(field.map(p => p.score))) {
        const bracket = field.filter(p => p.score === score);
        const half = Math.ceil(bracket.length / 2);
        for (let i = 0; i + half < bracket.length; i++) {
          preferred.set(bracket[i].id, bracket[i + half].id);
          preferred.set(bracket[i + half].id, bracket[i].id);
        }
      }
      const matches = search(field);
      if (matches) {
        const result = { matches, bye: bye?.id ?? null, visited };
        validate(players, result);
        return result;
      }
    }
    throw new DomainError('NO_VALID_PAIRING', 'No pairing satisfies opponent, color and bye constraints');
  }
}
class FormatRegistry {
  constructor() { this.formats = new Map([['SWISS', new SwissFormat()]]); }
  register(name, strategy) { this.formats.set(name, strategy); }
  get(name) {
    requireThat(this.formats.has(name), 'UNSUPPORTED_FORMAT', 'Unknown tournament format', 400);
    return this.formats.get(name);
  }
}
module.exports = { SwissFormat, FormatRegistry, validate, allowedColor };

const { randomUUID } = require("node:crypto");
const { TournamentService } = require("../tournaments/service");
const { TournamentRepository, hash } = require("./tournament-repository");
const { TournamentWriter } = require("./tournament-writer");
const { requireThat } = require("../tournaments/errors");
const { json, date } = require("./database");

// A disposable command plan, never a durable checkpoint or storage fallback.
function planner(t, now, connections = new Map()) {
  const state = {
    tournaments: t ? { [t.id]: structuredClone(t) } : {},
    outbox: [],
    eventSequence: 0,
  };
  const service = new TournamentService({
    store: { read: (fn) => fn(state), transaction: (fn) => fn(state) },
    clock: () => now,
    settleResult: () => null,
  });
  service.connections = new Map(
    [...connections]
      .filter(([key]) => !t || key.startsWith(t.id + ":"))
      .map(([key, set]) => [key, new Set(set)]),
  );
  return { service, state };
}
class SqlTournaments {
  constructor(uow) {
    this.uow = uow;
    this.repo = new TournamentRepository();
    this.epoch = randomUUID();
    this.writer = new TournamentWriter(this.epoch);
    this.connections = new Map();
    this.tail = Promise.resolve();
    this.stopping = false;
  }
  // Presence plans share runtime socket sets. Publish a plan only after COMMIT.
  serial(fn) {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  async create(config) {
    return this.serial(() =>
      this.uow.run(async (tx) => {
        if (config.key) {
          const [[row]] = await tx.c.execute(
            "SELECT tournament_id FROM tournament WHERE provision_key=?",
            [config.key],
          );
          if (row) {
            const t = await this.repo.load(tx.c, row.tournament_id);
            return planner(t, await tx.now()).service._public(t);
          }
        }
        const p = planner(null, await tx.now());
        const result = p.service.create(config),
          t = p.state.tournaments[result.id];
        await this.repo.create(tx.c, t);
        await this.writer.save(
          tx,
          { ...structuredClone(t), version: 0 },
          t,
          p.state.outbox,
        );
        await this.schedule(tx, p.service, t);
        return result;
      }),
    );
  }
  async schedule(tx, service, t) {
    await tx.c.execute(
      "UPDATE scheduled_action SET status='CANCELLED',lease_owner=NULL,lease_expires_at=NULL WHERE tournament_id=? AND status IN ('PENDING','CLAIMED')",
      [t.id],
    );
    const next = service._next(t);
    if (!next) return;
    const types = {
      CLOSE: "REGISTRATION_CLOSE",
      START: "ROUND_START",
      END: "MATCH_DEADLINE",
      DISCONNECT: "RECONNECT_EXPIRY",
    };
    const round =
      next.round ??
      t.rounds.find((r) => r.matches.some((m) => m.id === next.match?.id));
    let participant = null;
    if (next.type === "DISCONNECT") {
      const ds = next.match.game.disconnects,
        side =
          ds.white && ds.black
            ? ds.white.deadlineAt >= ds.black.deadlineAt
              ? "WHITE"
              : "BLACK"
            : ds.white
              ? "WHITE"
              : "BLACK";
      const [[p]] = await tx.c.execute(
        "SELECT participant_id FROM game_participant WHERE game_session_id=? AND color=?",
        [next.match.game.id, side],
      );
      participant = p.participant_id;
    }
    // Generation changes even when recovery modifies only presence.
    const { insert } = require("./database");
    await insert(tx.c, "scheduled_action", {
      action_id: randomUUID(),
      action_type: types[next.type],
      tournament_id: t.id,
      round_id: round?.id ?? null,
      match_id: next.match?.id ?? null,
      participant_id: participant,
      game_session_id: participant ? next.match.game.id : null,
      due_at: date(next.at),
      generation: t.version,
      deduplication_key: randomUUID(),
    });
  }
  async mutate(id, action, args = [], { reconcile = true } = {}) {
    return this.serial(async () => {
      requireThat(
        !this.stopping || ["tick", "prepareShutdown"].includes(action),
        "SERVER_STOPPING",
        "Server is shutting down; reconnect shortly",
        503,
      );
      // Expiry is a separately committed command, so a rejected late action
      // cannot roll back its authoritative result.
      if (reconcile) await this.apply(id, "tick", []);
      return this.apply(id, action, args);
    });
  }
  async apply(id, action, args) {
    let committed;
    let reconciled = false;
    const response = await this.uow.run(async (tx) => {
      reconciled = false;
      const before = await this.repo.load(tx.c, id, { lock: true }),
        now = await tx.now();
      const p = planner(before, now, this.connections);
      // A deadline may cross while waiting for the parent lock after the first
      // reconciliation. Commit that transition before trying the user action.
      const next = p.service._next(before);
      if (
        !["tick", "recover", "prepareShutdown"].includes(action) &&
        next &&
        next.at <= now
      ) {
        p.service.tick();
        const t = p.state.tournaments[id];
        await this.writer.save(tx, before, t, p.state.outbox);
        await this.schedule(tx, p.service, t);
        reconciled = true;
        return;
      }
      // SQL receipts store a digest, while the pure planner uses raw JSON.
      if (action === "command") {
        const [matchId, playerId, command] = args,
          m = p.service._match(before, matchId).match;
        p.service._side(before, m, playerId);
        const previous = m.game.commands[`${playerId}:${command?.commandId}`];
        if (previous) {
          requireThat(
            previous.fingerprint === hash(JSON.stringify(command)),
            "COMMAND_CONFLICT",
            "commandId was used for a different action",
          );
          return previous.response;
        }
      }
      let result;
      if (["tick", "recover", "prepareShutdown", "disconnect"].includes(action))
        result = p.service[action](...args);
      else result = p.service[action](id, ...args);
      const t = p.state.tournaments[id];
      if (JSON.stringify(t) !== JSON.stringify(before)) {
        await this.writer.save(tx, before, t, p.state.outbox);
        await this.schedule(tx, p.service, t);
      }
      // Rebuild response after settlement so the acknowledgement has SQL Elo.
      if (["command", "join"].includes(action) && result)
        result = p.service._gameView(
          t,
          p.service._match(t, args[0]).match,
          args[1],
        );
      committed = p.service.connections;
      return result;
    });
    if (committed) {
      for (const key of this.connections.keys())
        if (key.startsWith(id + ":")) this.connections.delete(key);
      for (const [key, set] of committed) this.connections.set(key, set);
    }
    if (reconciled) return this.apply(id, action, args);
    return response;
  }
  async read(id, method, args = []) {
    await this.mutate(id, "tick", [], { reconcile: false });
    return this.uow.run(
      async (tx) => {
        const t = await this.repo.load(tx.c, id),
          p = planner(t, await tx.now());
        // Readers must never invent a deadline result inside a disposable plan.
        // The committed reconciliation above and this consistent SQL snapshot
        // define the read; a later boundary is handled by the next command/tick.
        p.service.tick = () => {};
        return p.service[method](id, ...args);
      },
      { snapshot: true },
    );
  }
  get(id) {
    return this.read(id, "get");
  }
  standings(id) {
    return this.read(id, "standings");
  }
  mine(id, player) {
    return this.read(id, "mine", [player]);
  }
  game(id, match, player) {
    return this.read(id, "game", [match, player]);
  }
  register(id, player) {
    return this.mutate(id, "register", [player]);
  }
  withdraw(id, player) {
    return this.mutate(id, "withdraw", [player]);
  }
  join(id, match, player, socket) {
    return this.mutate(id, "join", [match, player, socket]);
  }
  command(id, match, player, command) {
    return this.mutate(id, "command", [match, player, command]);
  }
  async ids() {
    return this.uow.run((tx) => this.repo.listIds(tx.c), { readOnly: true });
  }
  async list() {
    const result = [];
    for (const id of await this.ids()) result.push(await this.get(id));
    return result;
  }
  async disconnect(socket) {
    if (this.stopping) return;
    const ids = new Set(
      [...this.connections]
        .filter(([, set]) => set.has(socket))
        .map(([key]) => key.split(":")[0]),
    );
    for (const id of ids) await this.mutate(id, "disconnect", [socket]);
  }
  async recover() {
    for (const id of await this.ids())
      await this.mutate(id, "recover", [], { reconcile: false });
  }
  async prepareShutdown() {
    this.stopping = true;
    for (const id of await this.ids()) await this.mutate(id, "prepareShutdown");
  }
  async tick() {
    const ids = await this.uow.run(
      async (tx) => {
        const [rows] = await tx.c.execute(
          "SELECT DISTINCT tournament_id FROM scheduled_action WHERE status='PENDING' AND due_at<=?",
          [date(await tx.now())],
        );
        return rows.map((r) => r.tournament_id);
      },
      { readOnly: true },
    );
    for (const id of ids)
      await this.mutate(id, "tick", [], { reconcile: false });
  }
  async flushEvents(deliver) {
    const rows = await this.uow.run(
      async (tx) => {
        const [rows] = await tx.c.query(
          "SELECT * FROM outbox_event WHERE delivery_status='PENDING' ORDER BY event_sequence LIMIT 100",
        );
        return rows;
      },
      { readOnly: true },
    );
    for (const row of rows) {
      await deliver({
        id: row.event_id,
        tournamentId: row.tournament_id,
        type: row.event_type,
        version: Number(row.aggregate_version),
        payload: json(row.payload),
      });
      await this.uow.run((tx) =>
        tx.c.execute(
          "UPDATE outbox_event SET delivery_status='DELIVERED',delivered_at=UTC_TIMESTAMP(3),attempt_count=attempt_count+1 WHERE event_id=?",
          [row.event_id],
        ),
      );
    }
  }
}
module.exports = { SqlTournaments, planner };

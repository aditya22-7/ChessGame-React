const { randomUUID } = require("node:crypto");
const engine = require("../games/engine");
const { insert, date } = require("./database");
const { gameData, readResult, hash } = require("./tournament-repository");
const { ResultService } = require("./results");
const { requireThat } = require("../tournaments/errors");
const square = (p) => String.fromCharCode(97 + p.col) + (p.row + 1);
class QuickGames {
  constructor(uow) {
    this.uow = uow;
    this.results = new ResultService();
  }
  async create(players) {
    return this.uow.run(async (tx) => {
      const id = randomUUID(),
        now = await tx.now();
      await insert(tx.c, "game_session", {
        game_session_id: id,
        origin: "QUICK_PLAY",
        engine_ruleset_version: engine.ruleset,
      });
      for (let i = 0; i < 2; i++)
        await insert(tx.c, "game_participant", {
          participant_id: randomUUID(),
          game_session_id: id,
          color: i ? "BLACK" : "WHITE",
          player_id: players[i].id ?? null,
          guest_label: players[i].id ? null : players[i].name.slice(0, 64),
          first_joined_at: date(now),
        });
      await tx.c.execute(
        "UPDATE game_session SET status='IN_PROGRESS',started_at=? WHERE game_session_id=?",
        [date(now), id],
      );
      return id;
    });
  }
  async load(c, id, lock = false) {
    const [[row]] = await c.execute(
      "SELECT * FROM game_session WHERE game_session_id=? AND origin='QUICK_PLAY'" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    );
    requireThat(row, "NOT_FOUND", "Game not found", 404);
    requireThat(
      row.engine_ruleset_version === engine.ruleset,
      "UNSUPPORTED_GAME_RULESET",
      "Unsupported game ruleset",
    );
    return { row, ...(await gameData(c, row)) };
  }
  async view(id) {
    return this.uow.run(
      async (tx) => {
        const { game } = await this.load(tx.c, id);
        const [[r]] = await tx.c.execute(
          "SELECT * FROM game_result WHERE game_session_id=?",
          [id],
        );
        return {
          ...engine.view(engine.restore(game.moves)),
          moveSequence: game.moves.length,
          result: await readResult(tx.c, r),
        };
      },
      { snapshot: true },
    );
  }
  async move(id, color, command) {
    return this.uow.run(async (tx) => {
      const { game, parts, row } = await this.load(tx.c, id, true),
        part = parts.find((p) => p.color === color.toUpperCase());
      requireThat(
        command &&
          typeof command.commandId === "string" &&
          /^[\w-]{1,100}$/.test(command.commandId),
        "INVALID_COMMAND",
        "Command ID required",
        400,
      );
      const [[previous]] = await tx.c.execute(
        "SELECT * FROM game_command_receipt WHERE game_session_id=? AND participant_id=? AND command_id=?",
        [id, part.participant_id, command.commandId],
      );
      const fingerprint = hash(JSON.stringify(command));
      if (previous) {
        requireThat(
          previous.request_hash === fingerprint,
          "COMMAND_CONFLICT",
          "Command ID reused",
        );
        return require("./database").json(previous.response_payload);
      }
      requireThat(row.status === "IN_PROGRESS", "GAME_OVER", "Game has ended");
      requireThat(
        command.expectedMoveSequence === game.moves.length,
        "STALE_MOVE",
        "Refresh game state",
      );
      requireThat(
        row.side_to_move === part.color,
        "NOT_YOUR_TURN",
        "It is not your turn",
        403,
      );
      const candidate = engine.restore(game.moves);
      engine.apply(candidate, command);
      const now = await tx.now(),
        seq = game.moves.length + 1;
      await insert(tx.c, "game_move", {
        move_id: randomUUID(),
        game_session_id: id,
        move_sequence: seq,
        participant_id: part.participant_id,
        from_square: square(command.from),
        to_square: square(command.to),
        accepted_at: date(now),
      });
      await tx.c.execute(
        "UPDATE game_session SET current_move_sequence=?,side_to_move=? WHERE game_session_id=?",
        [seq, part.color === "WHITE" ? "BLACK" : "WHITE", id],
      );
      if (candidate.status)
        await this.results.finalize(tx, {
          sessionId: id,
          outcome: candidate.status === "White" ? "WHITE_WIN" : "BLACK_WIN",
          reason: "GAME_COMPLETED",
          at: now,
        });
      const [[result]] = await tx.c.execute(
        "SELECT * FROM game_result WHERE game_session_id=?",
        [id],
      );
      const response = {
        ...engine.view(candidate),
        moveSequence: seq,
        result: await readResult(tx.c, result),
      };
      await insert(tx.c, "game_command_receipt", {
        game_session_id: id,
        participant_id: part.participant_id,
        command_id: command.commandId,
        request_hash: fingerprint,
        accepted_move_sequence: seq,
        response_payload: JSON.stringify(response),
      });
      return response;
    });
  }
  async leave(id, color) {
    return this.uow.run(async (tx) => {
      const { row } = await this.load(tx.c, id, true);
      if (row.status === "FINALIZED") return;
      await this.results.finalize(tx, {
        sessionId: id,
        outcome: color === "white" ? "BLACK_WIN" : "WHITE_WIN",
        reason: "WITHDRAWAL",
        at: await tx.now(),
      });
    });
  }
  // Legacy quick-play has no resume token. Persist an explicit unrated recovery
  // result instead of silently discarding an abandoned board after restart.
  async recover() {
    const ids = await this.uow.run(
      async (tx) => {
        const [rows] = await tx.c.query(
          "SELECT game_session_id FROM game_session WHERE origin='QUICK_PLAY' AND status='IN_PROGRESS'",
        );
        return rows.map((r) => r.game_session_id);
      },
      { readOnly: true },
    );
    for (const id of ids)
      await this.uow.run(async (tx) => {
        const { row } = await this.load(tx.c, id, true);
        if (row.status !== "FINALIZED")
          await this.results.finalize(tx, {
            sessionId: id,
            outcome: "DRAW",
            reason: "DOUBLE_DISCONNECT",
            at: await tx.now(),
          });
      });
  }
}

/** Keeps the existing quick-play socket vocabulary, committing before emits. */
class QuickTransport {
  constructor(games) {
    this.games = games;
    this.waiting = null;
    this.tail = Promise.resolve();
    this.stopping = false;
  }
  serial(fn) {
    const pending = this.tail.then(fn);
    this.tail = pending.catch(() => {});
    return pending;
  }
  manager(socket) {
    const bind = (event, fn) =>
      socket.on(event, (...args) => {
        this.serial(() => (this.stopping ? undefined : fn(...args))).catch(
          (error) => {
            console.error(
              "SQL quick-play command failed:",
              error.code ?? error.message,
            );
            socket.emit(
              event === "pt"
                ? "from"
                : event === "newgame"
                  ? "quickplay:error"
                  : "to",
              event === "newgame"
                ? { code: error.code ?? "INTERNAL_ERROR" }
                : "invalid",
            );
          },
        );
      });
    const data = async (s) => {
      const room = s.data.sqlQuick;
      if (!room) return { waiting: true };
      const v = await this.games.view(room.id);
      return {
        board: v.board,
        freeze: v.turn !== s.side || Boolean(v.result),
        name: room.sockets.find((p) => p !== s)?.name,
        side: s.side,
        rated: room.rated,
        result: v.result,
        status: v.winner,
        moveSequence: v.moveSequence,
      };
    };
    bind("newgame", async (name) => {
      if (
        this.stopping ||
        socket.side ||
        socket.data.quickPlayJoining ||
        socket.data.tournamentPlayerId ||
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 64
      )
        return;
      socket.data.quickPlayJoining = true;
      try {
        let player = null;
        if (socket.request.session?.isAuth)
          await new Promise((resolve) =>
            socket.request.session.reload((error) => {
              if (!error && socket.request.session?.isAuth)
                player = {
                  id: socket.request.session.playerId,
                  name: socket.request.session.name,
                };
              resolve();
            }),
          );
        if (!socket.connected) return;
        socket.name = player?.name ?? name;
        socket.data.quickIdentity = player ?? { name };
        if (!this.waiting?.connected) {
          this.waiting = socket;
          socket.side = "white";
          return;
        }
        const white = this.waiting;
        const id = await this.games.create([
          white.data.quickIdentity,
          socket.data.quickIdentity,
        ]);
        this.waiting = null;
        socket.side = "black";
        const room = {
          id,
          sockets: [white, socket],
          rated: Boolean(
            white.data.quickIdentity.id &&
              player?.id &&
              white.data.quickIdentity.id !== player.id,
          ),
        };
        for (const s of room.sockets) s.data.sqlQuick = room;
        for (const s of room.sockets) s.emit("getdata", await data(s));
      } finally {
        socket.data.quickPlayJoining = false;
      }
    });
    bind("getdata", async () => socket.emit("getdata", await data(socket)));
    bind("pt", async (p) => {
      const room = socket.data.sqlQuick;
      if (!room || !engine.coordinate(p)) return socket.emit("from", "invalid");
      const view = await this.games.view(room.id);
      if (view.turn !== socket.side || view.result)
        return socket.emit("from", "invalid");
      // Replay from the authoritative journal to obtain legal destination tiles.
      const game = await this.games.uow.run(
        async (tx) =>
          engine.restore((await this.games.load(tx.c, room.id)).game.moves),
        { snapshot: true },
      );
      const tile = game.board.getTile(p.row, p.col);
      if (!tile.piece || tile.piece.color !== (socket.side === "white"))
        return socket.emit("from", "invalid");
      socket.data.quickFrom = { ...p };
      socket.data.quickSequence = view.moveSequence;
      socket.emit(
        "from",
        tile.piece.permittedTiles.map((t) => ({ row: t.row, col: t.col })),
      );
    });
    bind("to", async (to) => {
      const room = socket.data.sqlQuick;
      if (!room || !socket.data.quickFrom) return socket.emit("to", "invalid");
      const command = {
        commandId: randomUUID(),
        expectedMoveSequence: socket.data.quickSequence,
        from: socket.data.quickFrom,
        to,
      };
      const view = await this.games.move(room.id, socket.side, command);
      delete socket.data.quickFrom;
      const response = view.winner
        ? { board: view.board, status: view.winner }
        : view.board;
      socket.emit("to", response);
      room.sockets.find((s) => s !== socket)?.emit("move", response);
    });
    const leave = async () => {
      if (this.waiting === socket) this.waiting = null;
      const room = socket.data.sqlQuick;
      if (room && !this.stopping) {
        await this.games.leave(room.id, socket.side);
        room.sockets.find((s) => s !== socket)?.emit("playerleft");
      }
      delete socket.data.sqlQuick;
      delete socket.data.quickFrom;
      socket.side = null;
    };
    bind("leavegame", async () => {
      await leave();
      socket.emit("left");
    });
    socket.on("disconnect", () =>
      this.serial(leave).catch((error) =>
        console.error(
          "Quick-play disconnect persistence failed:",
          error.code ?? error.message,
        ),
      ),
    );
    socket.on("end", () => socket.disconnect(false));
  }
  async close() {
    this.stopping = true;
    await this.tail;
    await this.games.recover();
  }
}
module.exports = { QuickGames, QuickTransport };

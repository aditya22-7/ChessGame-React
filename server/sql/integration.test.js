const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createSqlServer } = require("./app");
const once = (emitter, event) =>
  require("node:events").once(emitter, event, {
    signal: AbortSignal.timeout(5000),
  });
const { io: connect } = require("socket.io-client");
const enabled = process.env.SQL_INTEGRATION === "1";
test("MySQL backend flows", { skip: !enabled, timeout: 120000 }, async (t) => {
  let now = Date.now();
  const options = {
    env: process.env,
    sessionSecret: "test-secret-at-least-thirty-two-characters",
    clock: () => now,
    worker: false,
  };
  let app = await createSqlServer(options);
  t.after(async () => {
    await app.close();
  });
  const players = [];
  for (let i = 0; i < 6; i++)
    players.push(
      await app.accounts.create("sql_" + randomUUID().slice(0, 12), "password"),
    );
  const create = async (n = 2, rounds = 1) => {
    const v = await app.tournaments.create({
      name: "SQL " + randomUUID(),
      registrationClosesAt: now + 1000,
      firstRoundStartsAt: now + 2000,
      totalRounds: rounds,
      matchDurationMs: 10000,
      interRoundGapMs: 1000,
      reconnectGraceMs: 500,
    });
    for (const p of players.slice(0, n))
      await app.tournaments.register(v.id, p.id);
    return v.id;
  };
  const fixture = async (id) => {
    const v = await app.tournaments.get(id),
      r = v.rounds.find(
        (r) => r.status === "PAIRED" || r.status === "IN_PROGRESS",
      );
    const m = r.matches[0];
    const raw = await app.db.uow.run(
      (tx) => app.tournaments.repo.load(tx.c, id),
      { readOnly: true },
    );
    return {
      ...m,
      white: raw.entrants.find((e) => e.id === m.whiteEntrantId).playerId,
      black: raw.entrants.find((e) => e.id === m.blackEntrantId).playerId,
    };
  };
  const start = async (id) => {
    now += 1000;
    await app.run();
    const m = await fixture(id);
    await app.tournaments.join(id, m.id, m.white, "w");
    await app.tournaments.join(id, m.id, m.black, "b");
    now += 1000;
    await app.run();
    return m;
  };
  await t.test(
    "registration, played result, Elo and idempotent commands",
    async () => {
      const id = await create(),
        m = await start(id);
      const move = {
        commandId: "move-1",
        type: "MOVE",
        expectedMoveSequence: 0,
        from: { row: 1, col: 4 },
        to: { row: 3, col: 4 },
      };
      const first = await app.tournaments.command(id, m.id, m.white, move);
      assert.equal(first.moveSequence, 1);
      assert.deepEqual(
        await app.tournaments.command(id, m.id, m.white, move),
        JSON.parse(JSON.stringify(first)),
      );
      await assert.rejects(
        app.tournaments.command(id, m.id, m.white, { ...move, type: "RESIGN" }),
        { code: "COMMAND_CONFLICT" },
      );
      await app.tournaments.command(id, m.id, m.black, {
        commandId: "move-2",
        type: "MOVE",
        expectedMoveSequence: 1,
        from: { row: 6, col: 4 },
        to: { row: 4, col: 4 },
      });
      const result = await app.tournaments.command(id, m.id, m.black, {
        commandId: "resign",
        type: "RESIGN",
      });
      assert.equal(result.result.rating.rated, true);
      assert.equal((await app.ratings.get(m.white)).rating, 1216);
      assert.equal((await app.tournaments.get(id)).status, "COMPLETED");
      assert.equal((await app.ratings.history(m.white)).games.length, 1);
      assert.equal((await app.tournaments.standings(id))[0].score, 1);
    },
  );
  await t.test(
    "hard deadline commits draw even when a late command fails",
    async () => {
      const id = await create(),
        m = await start(id);
      now += 10000;
      await assert.rejects(
        app.tournaments.command(id, m.id, m.white, {
          commandId: "late",
          type: "RESIGN",
        }),
        { code: "MATCH_NOT_PLAYING" },
      );
      const result = (await app.tournaments.game(id, m.id, m.white)).result;
      assert.equal(result.reason, "MATCH_DEADLINE");
      assert.equal(result.whitePoints, 0.5);
      assert.equal(result.effectiveAt, now);
    },
  );
  await t.test(
    "deadline crossing during lock acquisition still commits before rejecting the command",
    async () => {
      const id = await create(),
        m = await start(id);
      let calls = 0;
      const clock = app.db.uow.clock;
      app.db.uow.clock = () => (calls++ === 0 ? now : now + 10000);
      try {
        await assert.rejects(
          app.tournaments.command(id, m.id, m.white, {
            commandId: "boundary",
            type: "RESIGN",
          }),
          { code: "MATCH_NOT_PLAYING" },
        );
      } finally {
        app.db.uow.clock = clock;
        now += 10000;
      }
      assert.equal(
        (await app.tournaments.game(id, m.id, m.white)).result.reason,
        "MATCH_DEADLINE",
      );
    },
  );
  await t.test(
    "snapshot reads never expose an uncommitted deadline result",
    async () => {
      const id = await create(),
        m = await start(id);
      let calls = 0;
      const clock = app.db.uow.clock;
      app.db.uow.clock = () => (calls++ === 0 ? now : now + 10000);
      try {
        assert.equal(
          (await app.tournaments.game(id, m.id, m.white)).result,
          null,
        );
      } finally {
        app.db.uow.clock = clock;
        now += 10000;
      }
      await app.run();
      assert.equal(
        (await app.tournaments.game(id, m.id, m.white)).result.reason,
        "MATCH_DEADLINE",
      );
    },
  );
  await t.test("no-shows and permanent withdrawal", async () => {
    const id = await create();
    now += 2000;
    await app.run();
    assert.equal(
      (await app.tournaments.get(id)).rounds[0].matches[0].result.reason,
      "DOUBLE_NO_SHOW",
    );
    const id2 = await create();
    now += 1000;
    await app.run();
    const m = await fixture(id2);
    await app.tournaments.withdraw(id2, m.black);
    assert.equal(
      (await app.tournaments.game(id2, m.id, m.white)).result.outcome,
      "WHITE_WIN",
    );
    await assert.rejects(app.tournaments.register(id2, m.black), {
      code: "WITHDRAWN",
    });
    now += 1000;
    await app.run();
    assert.equal((await app.tournaments.get(id2)).status, "COMPLETED");
  });
  await t.test("reconnection and multi-socket attendance", async () => {
    const id = await create(),
      m = await start(id);
    await app.tournaments.join(id, m.id, m.white, "w2");
    await app.tournaments.disconnect("w");
    assert.equal(
      (await app.tournaments.game(id, m.id, m.white)).disconnects.white,
      null,
    );
    await app.tournaments.disconnect("w2");
    now += 100;
    await app.tournaments.join(id, m.id, m.white, "w3");
    assert.equal(
      (await app.tournaments.game(id, m.id, m.white)).disconnects.white,
      null,
    );
    await app.tournaments.disconnect("w3");
    now += 500;
    await app.run();
    assert.equal(
      (await app.tournaments.game(id, m.id, m.white)).result.reason,
      "RECONNECT_EXPIRED",
    );
  });
  await t.test("Swiss multi-round odd field, byes, no repeats", async () => {
    const id = await create(5, 3);
    now += 1000;
    await app.run();
    for (let i = 0; i < 3; i++) {
      const v = await app.tournaments.get(id);
      now = v.rounds[i].startsAt;
      await app.run();
    }
    const v = await app.tournaments.get(id);
    assert.equal(v.status, "COMPLETED");
    const pairs = v.rounds.flatMap((r) =>
      r.matches.map((m) =>
        [m.whiteEntrantId, m.blackEntrantId].sort().join(":"),
      ),
    );
    assert.equal(new Set(pairs).size, pairs.length);
    assert.equal(v.rounds.flatMap((r) => r.awards).length, 3);
  });
  await t.test(
    "quick-play durable journal, stale move rollback and leave",
    async () => {
      const id = await app.games.create(players.slice(0, 2));
      await app.games.move(id, "white", {
        commandId: "q1",
        expectedMoveSequence: 0,
        from: { row: 1, col: 4 },
        to: { row: 3, col: 4 },
      });
      await assert.rejects(
        app.games.move(id, "black", {
          commandId: "q2",
          expectedMoveSequence: 0,
          from: { row: 6, col: 4 },
          to: { row: 4, col: 4 },
        }),
        { code: "STALE_MOVE" },
      );
      assert.equal((await app.games.view(id)).moveSequence, 1);
      await app.games.leave(id, "black");
      assert.equal((await app.games.view(id)).result.reason, "WITHDRAWAL");
    },
  );
  await t.test(
    "quick-play king capture settles Elo once and journal replays the final board",
    async () => {
      const id = await app.games.create(players.slice(0, 2)),
        before = await app.ratings.get(players[0].id);
      const sequence = [
        [
          [1, 4],
          [3, 4],
        ],
        [
          [6, 0],
          [5, 0],
        ],
        [
          [0, 4],
          [2, 4],
        ],
        [
          [6, 7],
          [5, 7],
        ],
        [
          [2, 4],
          [5, 1],
        ],
        [
          [5, 0],
          [4, 0],
        ],
        [
          [5, 1],
          [6, 2],
        ],
        [
          [5, 7],
          [4, 7],
        ],
        [
          [6, 2],
          [7, 3],
        ],
      ];
      let response, command;
      for (let i = 0; i < sequence.length; i++) {
        const [from, to] = sequence[i];
        command = {
          commandId: "capture-" + i,
          expectedMoveSequence: i,
          from: { row: from[0], col: from[1] },
          to: { row: to[0], col: to[1] },
        };
        response = await app.games.move(id, i % 2 ? "black" : "white", command);
      }
      assert.equal(response.result.reason, "GAME_COMPLETED");
      assert.equal(response.result.rating.rated, true);
      assert.deepEqual((await app.games.view(id)).board, response.board);
      await app.games.move(id, "white", command);
      assert.equal(
        (await app.ratings.get(players[0].id)).ratedGames,
        before.ratedGames + 1,
      );
    },
  );
  await t.test(
    "one overdue tick catches up multiple fixed rounds transactionally",
    async () => {
      const id = await create(4, 3);
      now += 25000;
      await app.run();
      const v = await app.tournaments.get(id);
      assert.equal(v.status, "COMPLETED");
      assert.ok(v.rounds.every((r) => r.status === "COMPLETED"));
    },
  );
  await t.test(
    "concurrent retries settle exactly once; losing turn is rejected",
    async () => {
      const id = await create(),
        m = await start(id);
      const command = {
        commandId: "concurrent",
        type: "MOVE",
        expectedMoveSequence: 0,
        from: { row: 1, col: 4 },
        to: { row: 3, col: 4 },
      };
      const responses = await Promise.all([
        app.tournaments.command(id, m.id, m.white, command),
        app.tournaments.command(id, m.id, m.white, command),
      ]);
      assert.equal(responses[0].moveSequence, 1);
      assert.equal(responses[1].moveSequence, 1);
      await assert.rejects(
        app.tournaments.command(id, m.id, m.white, {
          ...command,
          commandId: "wrong-turn",
          expectedMoveSequence: 1,
        }),
        { code: "NOT_YOUR_TURN" },
      );
      await app.tournaments.command(id, m.id, m.black, {
        commandId: "black",
        type: "MOVE",
        expectedMoveSequence: 1,
        from: { row: 6, col: 4 },
        to: { row: 4, col: 4 },
      });
      const resign = { commandId: "duplicate-result", type: "RESIGN" };
      await Promise.all([
        app.tournaments.command(id, m.id, m.black, resign),
        app.tournaments.command(id, m.id, m.black, resign),
      ]);
      const count = await app.db.uow.run(
        async (tx) =>
          (
            await tx.c.execute(
              "SELECT COUNT(*) n FROM game_result WHERE tournament_match_id=?",
              [m.id],
            )
          )[0][0].n,
        { readOnly: true },
      );
      assert.equal(Number(count), 1);
    },
  );
  await t.test(
    "SQL failure rolls back result, Elo, receipt and next pairing",
    async () => {
      const id = await create(),
        m = await start(id);
      await app.tournaments.command(id, m.id, m.white, {
        commandId: "atomic1",
        type: "MOVE",
        expectedMoveSequence: 0,
        from: { row: 1, col: 4 },
        to: { row: 3, col: 4 },
      });
      await app.tournaments.command(id, m.id, m.black, {
        commandId: "atomic2",
        type: "MOVE",
        expectedMoveSequence: 1,
        from: { row: 6, col: 4 },
        to: { row: 4, col: 4 },
      });
      const before = await app.ratings.get(m.white),
        original = app.tournaments.writer.results.finalize;
      app.tournaments.writer.results.finalize = async function (tx, options) {
        await original.call(this, tx, options);
        throw new Error("Injected failure after settlement");
      };
      const command = { commandId: "atomic-resign", type: "RESIGN" };
      try {
        await assert.rejects(
          app.tournaments.command(id, m.id, m.black, command),
          /Injected failure/,
        );
      } finally {
        app.tournaments.writer.results.finalize = original;
      }
      assert.equal(
        (await app.tournaments.game(id, m.id, m.white)).result,
        null,
      );
      assert.deepEqual(await app.ratings.get(m.white), before);
      assert.equal(
        (await app.tournaments.command(id, m.id, m.black, command)).result
          .rating.rated,
        true,
      );
    },
  );
  await t.test(
    "draw offers, single no-show and double disconnection",
    async () => {
      const id = await create(),
        m = await start(id);
      await app.tournaments.command(id, m.id, m.white, {
        commandId: "offer",
        type: "OFFER_DRAW",
      });
      const draw = await app.tournaments.command(id, m.id, m.black, {
        commandId: "accept",
        type: "ACCEPT_DRAW",
      });
      assert.equal(draw.result.reason, "DRAW_AGREEMENT");
      const id2 = await create();
      now += 1000;
      await app.run();
      const m2 = await fixture(id2);
      await app.tournaments.join(id2, m2.id, m2.white, "single");
      now += 1000;
      await app.run();
      assert.equal(
        (await app.tournaments.game(id2, m2.id, m2.white)).result.reason,
        "SINGLE_NO_SHOW",
      );
      const id3 = await create(),
        m3 = await start(id3);
      await app.tournaments.disconnect("w");
      await app.tournaments.disconnect("b");
      now += 500;
      await app.run();
      assert.equal(
        (await app.tournaments.game(id3, m3.id, m3.white)).result.reason,
        "DOUBLE_DISCONNECT",
      );
    },
  );
  await t.test(
    "insufficient field fails without inventing matches; pending bye withdrawal",
    async () => {
      const id = await app.tournaments.create({
        name: "Empty " + randomUUID(),
        registrationClosesAt: now + 1000,
        firstRoundStartsAt: now + 2000,
        totalRounds: 1,
        matchDurationMs: 10000,
        interRoundGapMs: 1000,
      });
      now += 1000;
      await app.run();
      assert.equal(
        (await app.tournaments.get(id.id)).failure.code,
        "INSUFFICIENT_FIELD",
      );
      const odd = await create(3);
      now += 1000;
      await app.run();
      const raw = await app.db.uow.run(
          (tx) => app.tournaments.repo.load(tx.c, odd),
          { readOnly: true },
        ),
        bye = raw.rounds[0].awards[0];
      await app.tournaments.withdraw(
        odd,
        raw.entrants.find((e) => e.id === bye.entrantId).playerId,
      );
      now += 1000;
      await app.run();
      assert.equal(
        (await app.tournaments.get(odd)).rounds[0].awards[0].points,
        0,
      );
    },
  );
  await t.test(
    "outbox delivery failure retains event and retries",
    async () => {
      await create();
      await assert.rejects(
        app.tournaments.flushEvents(() => {
          throw new Error("delivery failed");
        }),
        /delivery failed/,
      );
      const events = [];
      await app.tournaments.flushEvents((e) => events.push(e));
      assert.ok(events.length > 0);
      assert.ok(events.every((e) => e.id && e.version));
    },
  );
  await t.test("a second backend cannot acquire ownership", async () => {
    await assert.rejects(createSqlServer(options), /Another backend owns/);
  });
  await t.test(
    "migration refuses an actively owned backend database",
    async () => {
      const c = await require("mysql2/promise").createConnection(
        require("../../database/tools/connection").connectionOptions(),
      );
      try {
        await assert.rejects(
          require("../../database/tools/migrate").migrate(c),
          /Stop the backend/,
        );
      } finally {
        await c.end();
      }
    },
  );
  await t.test(
    "SQL auth, persistent sessions and HTTP registration",
    async () => {
      await new Promise((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
      );
      const url = "http://127.0.0.1:" + app.server.address().port;
      const response = await fetch(url + "/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: players[0].username,
          password: "password",
          count: 1,
        }),
      });
      assert.equal((await response.json()).status, "success");
      const cookie = response.headers.get("set-cookie").split(";")[0];
      assert.equal(
        (
          await (
            await fetch(url + "/players/me/rating", { headers: { cookie } })
          ).json()
        ).playerId,
        players[0].id,
      );
      const id = await create();
      assert.equal(
        (
          await fetch(url + `/tournaments/${id}/registrations`, {
            method: "POST",
            headers: { cookie },
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(url + "/logout", { method: "POST", headers: { cookie } }))
          .status,
        200,
      );
      assert.equal(
        (await fetch(url + "/tournaments", { headers: { cookie } })).status,
        401,
      );
    },
  );
  await t.test(
    "SQL sockets authenticate seats, commit moves, reject impersonation and revoke on logout",
    async () => {
      const url = "http://127.0.0.1:" + app.server.address().port,
        sockets = [];
      const login = async (player) => {
        const r = await fetch(url + "/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: player.username,
            password: "password",
            count: 1,
          }),
        });
        assert.equal((await r.json()).status, "success");
        return r.headers.get("set-cookie").split(";")[0];
      };
      const socket = async (cookie) => {
        const s = connect(url, {
          transports: ["websocket"],
          extraHeaders: cookie ? { Cookie: cookie } : {},
          forceNew: true,
          reconnection: false,
        });
        sockets.push(s);
        await once(s, "connect");
        return s;
      };
      const emit = (s, event, value) =>
        new Promise((resolve, reject) =>
          s
            .timeout(5000)
            .emit(event, value, (error, response) =>
              error ? reject(error) : resolve(response),
            ),
        );
      try {
        const cookies = await Promise.all(players.slice(0, 2).map(login));
        const id = await create();
        now += 1000;
        await app.run();
        const m = await fixture(id);
        const anonymous = await socket();
        assert.equal(
          (
            await emit(anonymous, "game:join", {
              tournamentId: id,
              matchId: m.id,
            })
          ).error.code,
          "UNAUTHENTICATED",
        );
        const a = await socket(cookies[0]),
          b = await socket(cookies[1]);
        const aJoin = await emit(a, "game:join", {
          tournamentId: id,
          matchId: m.id,
          playerId: "impersonation",
        });
        assert.equal(aJoin.ok, true);
        assert.equal(
          (await emit(b, "game:join", { tournamentId: id, matchId: m.id })).ok,
          true,
        );
        now += 1000;
        await app.run();
        const white = aJoin.data.side === "white" ? a : b,
          black = white === a ? b : a;
        const command = {
          commandId: "socket-1",
          type: "MOVE",
          expectedMoveSequence: 0,
          from: { row: 1, col: 4 },
          to: { row: 3, col: 4 },
        };
        assert.equal(
          (
            await emit(black, "game:command", {
              tournamentId: id,
              matchId: m.id,
              command,
            })
          ).error.code,
          "NOT_YOUR_TURN",
        );
        assert.equal(
          (
            await emit(white, "game:command", {
              tournamentId: id,
              matchId: m.id,
              command,
            })
          ).data.moveSequence,
          1,
        );
        const gone = once(a, "disconnect");
        await fetch(url + "/logout", {
          method: "POST",
          headers: { cookie: cookies[0] },
        });
        await gone;
      } finally {
        for (const s of sockets) s.disconnect();
        await app.tournaments.tail;
      }
    },
  );
  await t.test(
    "legacy quick-play socket flow persists accepted moves",
    async () => {
      const url = "http://127.0.0.1:" + app.server.address().port,
        sockets = [];
      const socket = async () => {
        const s = connect(url, {
          transports: ["websocket"],
          forceNew: true,
          reconnection: false,
        });
        sockets.push(s);
        await once(s, "connect");
        return s;
      };
      try {
        const a = await socket(),
          b = await socket();
        const ad = once(a, "getdata"),
          bd = once(b, "getdata");
        a.emit("newgame", "guest-a");
        b.emit("newgame", "guest-b");
        assert.equal((await ad)[0].side, "white");
        assert.equal((await bd)[0].side, "black");
        const from = once(a, "from");
        a.emit("pt", { row: 1, col: 4 });
        assert.ok((await from)[0].some((p) => p.row === 3 && p.col === 4));
        const to = once(a, "to"),
          move = once(b, "move");
        a.emit("to", { row: 3, col: 4 });
        assert.ok(Array.isArray((await to)[0]));
        assert.ok(Array.isArray((await move)[0]));
        const left = once(a, "left");
        a.emit("leavegame");
        await left;
      } finally {
        for (const s of sockets) s.disconnect();
      }
    },
  );
  await t.test(
    "restart reconstructs board and grants bounded server-restart grace",
    async () => {
      const id = await create(),
        m = await start(id);
      await app.tournaments.command(id, m.id, m.white, {
        commandId: "restart-move",
        type: "MOVE",
        expectedMoveSequence: 0,
        from: { row: 1, col: 4 },
        to: { row: 3, col: 4 },
      });
      const url = "http://127.0.0.1:" + app.server.address().port;
      const login = await fetch(url + "/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: players[0].username,
          password: "password",
          count: 1,
        }),
      });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      await app.close();
      now += 100;
      app = await createSqlServer(options);
      await new Promise((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
      );
      const auth = await fetch(
        "http://127.0.0.1:" + app.server.address().port + "/auth",
        { method: "POST", headers: { cookie } },
      );
      assert.equal((await auth.json()).status, "loggedIn");
      const view = await app.tournaments.game(id, m.id, m.black);
      assert.equal(view.moveSequence, 1);
      assert.equal(view.disconnects.white.cause, "SERVER_RESTART");
      await app.tournaments.join(id, m.id, m.white, "return-white");
      await app.tournaments.join(id, m.id, m.black, "return-black");
      await app.tournaments.command(id, m.id, m.black, {
        commandId: "return-move",
        type: "MOVE",
        expectedMoveSequence: 1,
        from: { row: 6, col: 4 },
        to: { row: 4, col: 4 },
      });
    },
  );
  await t.test("schema audit has no integrity issues", async () => {
    const rows = await app.db.uow.run(
      async (tx) =>
        (await tx.c.query("SELECT * FROM v_schema_integrity_issues"))[0],
      { readOnly: true },
    );
    assert.deepEqual(rows, []);
  });
  await t.test(
    "lost runtime lock connection fails closed without file fallback",
    async () => {
      const owner = await app.db.uow.run(
        async (tx) =>
          (
            await tx.c.execute("SELECT IS_USED_LOCK(?) owner_id", [
              "chess_runtime:" + process.env.MYSQL_DATABASE,
            ])
          )[0][0].owner_id,
        { readOnly: true },
      );
      assert.ok(Number.isSafeInteger(Number(owner)) && Number(owner) > 0);
      const admin = await require("mysql2/promise").createConnection(
        require("../../database/tools/connection").connectionOptions(),
      );
      try {
        await admin.query("KILL CONNECTION " + Number(owner));
      } finally {
        await admin.end();
      }
      for (let i = 0; i < 20 && app.db.isAvailable(); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(app.db.isAvailable(), false);
      await assert.rejects(app.tournaments.list(), {
        code: "DATABASE_UNAVAILABLE",
      });
      await assert.rejects(app.close(), { code: "DATABASE_UNAVAILABLE" });
    },
  );
});

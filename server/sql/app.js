const express = require("express");
const http = require("node:http");
const session = require("express-session");
const cors = require("cors");
const { Server } = require("socket.io");
const fs = require("node:fs");
const { createDatabase } = require("./database");
const { Accounts, SqlSessionStore, verifyPassword } = require("./accounts");
const { SqlTournaments } = require("./tournaments");
const { SqlRatings } = require("./ratings");
const { QuickGames, QuickTransport } = require("./quick-play");
const {
  router,
  socketTransport,
  errorPayload,
} = require("../tournaments/transport");
const { requireThat } = require("../tournaments/errors");

async function createSqlServer(options = {}) {
  const secret = options.sessionSecret ?? process.env.SESSION_SECRET;
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  const db = await createDatabase(options);
  let timer, io, server;
  try {
    const accounts = new Accounts(db.uow),
      tournaments = new SqlTournaments(db.uow),
      ratings = new SqlRatings(db.uow),
      games = new QuickGames(db.uow),
      quick = new QuickTransport(games);
    await tournaments.recover();
    await games.recover();
    if (options.provisionFile ?? process.env.TOURNAMENT_CONFIG_FILE) {
      const configs = JSON.parse(
        fs.readFileSync(
          options.provisionFile ?? process.env.TOURNAMENT_CONFIG_FILE,
          "utf8",
        ),
      );
      if (!Array.isArray(configs))
        throw new Error("Tournament config must be an array");
      for (const config of configs) {
        requireThat(
          typeof config.key === "string" && config.key.length > 0,
          "INVALID_CONFIG",
          "Provision key required",
        );
        await tournaments.create(config);
      }
    }
    const app = express(),
      origin =
        options.origin ?? process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
    let closing = false;
    if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
    app.use(cors({ origin, credentials: true }));
    app.use(express.urlencoded({ extended: false, limit: "16kb" }));
    app.use(express.json({ limit: "16kb" }));
    app.get("/health/ready", (req, res) => {
      const ready = !closing && db.isAvailable();
      res.status(ready ? 200 : 503).json({ ready, storage: "mysql" });
    });
    app.use((req, res, next) =>
      closing
        ? res.status(503).json({
            error: {
              code: "SERVER_STOPPING",
              message: "Server is shutting down",
            },
          })
        : next(),
    );
    const middleware = session({
      secret,
      resave: false,
      saveUninitialized: false,
      store: new SqlSessionStore(db.uow),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookies ?? process.env.NODE_ENV === "production",
        maxAge: 86400000,
      },
    });
    app.use(middleware);
    app.get('/session', (req, res) => {
      if (!req.session?.isAuth) return res.status(401).json({error:{code:'UNAUTHENTICATED',message:'Login required'}});
      res.json({playerId:req.session.playerId,name:req.session.name});
    });
    const wrap = (fn) => async (req, res, next) => {
      try {
        await fn(req, res);
      } catch (e) {
        next(e);
      }
    };
    const save = (s) =>
      new Promise((resolve, reject) =>
        s.save((e) => (e ? reject(e) : resolve())),
      );
    app.post(
      "/auth",
      wrap(async (req, res) => {
        if (req.session.isAuth === false) return res.json({ status: "failed" });
        if (req.session.isAuth)
          return res.json({ status: "loggedIn", name: req.session.name });
        req.session.try ??= 0;
        const { username, password, count } = req.body ?? {};
        if (!username && !password)
          return res.json({ status: "login", tries: req.session.try });
        if (count !== req.session.try + 1)
          return res.json({ status: "restart" });
        req.session.try++;
        const player = await accounts.findByUsername(username);
        if (
          player?.account_status === "ACTIVE" &&
          (await verifyPassword(password, player._password))
        ) {
          await new Promise((resolve, reject) =>
            req.session.regenerate((e) => (e ? reject(e) : resolve())),
          );
          req.session.isAuth = true;
          req.session.name = player.username;
          req.session.playerId = player.player_id;
          await db.uow.run((tx) =>
            tx.c.execute(
              "INSERT INTO player_accesslog(player_accesslog_id,playerID,login_time) VALUES (UUID(),?,UTC_TIMESTAMP())",
              [player.player_id],
            ),
          );
          await save(req.session);
          return res.json({ status: "success" });
        }
        if (req.session.try >= 3) req.session.isAuth = false;
        await save(req.session);
        res.json({
          status: req.session.isAuth === false ? "failed" : "failure",
        });
      }),
    );
    server = http.createServer(app);
    io = new Server(server, {
      cors: { origin, credentials: true },
      maxHttpBufferSize: 16384,
    });
    const deliver = socketTransport(io, tournaments, middleware);
    io.on("connection", (socket) => quick.manager(socket));
    app.post(
      "/logout",
      wrap(async (req, res) => {
        if (req.session.isAuth === undefined) return res.json("invalid");
        const sid = req.sessionID;
        await new Promise((resolve, reject) =>
          req.session.destroy((e) => (e ? reject(e) : resolve())),
        );
        for (const socket of io.sockets.sockets.values())
          if (socket.request.sessionID === sid) socket.disconnect(true);
        res.clearCookie("connect.sid");
        res.json("success");
      }),
    );
    app.use("/tournaments", router(tournaments));
    app.get(
      "/players/:playerId/:resource",
      wrap(async (req, res) => {
        requireThat(
          req.session?.isAuth,
          "UNAUTHENTICATED",
          "Login required",
          401,
        );
        const p = await accounts.findByUsername(
          req.params.playerId === "me" ? req.session.name : req.params.playerId,
        );
        requireThat(p, "PLAYER_NOT_FOUND", "Player not found", 404);
        if (req.params.resource === "rating")
          return res.json(await ratings.get(p.player_id));
        requireThat(
          req.params.resource === "rating-history",
          "NOT_FOUND",
          "Unknown resource",
          404,
        );
        res.json(
          await ratings.history(p.player_id, {
            limit: req.query.limit === undefined ? 20 : Number(req.query.limit),
            offset:
              req.query.offset === undefined ? 0 : Number(req.query.offset),
          }),
        );
      }),
    );
    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      if (!error.status)
        console.error("SQL backend error:", error.code ?? error.message);
      res.status(error.status ?? 500).json({ error: errorPayload(error) });
    });
    let work = null,
      closed = false;
    const run = () => {
      if (work) return work;
      work = (async () => {
        await tournaments.tick();
        await tournaments.flushEvents(deliver);
      })().finally(() => {
        work = null;
      });
      return work;
    };
    if (options.worker !== false) {
      timer = setInterval(
        () =>
          run().catch((e) =>
            console.error("SQL worker failed:", e.code ?? e.message),
          ),
        options.pollIntervalMs ?? 250,
      );
      timer.unref();
    }
    const close = async () => {
      if (closed) return;
      closed = true;
      closing = true;
      quick.stopping = true;
      tournaments.stopping = true;
      clearInterval(timer);
      let failure;
      try {
        if (work) await work;
        await tournaments.prepareShutdown();
        await quick.close();
        await tournaments.tail;
      } catch (e) {
        failure = e;
      }
      try {
        await new Promise((resolve) => io.close(resolve));
        if (server.listening)
          await new Promise((resolve) => server.close(resolve));
      } finally {
        await db.close();
      }
      if (failure) throw failure;
    };
    return {
      app,
      server,
      io,
      db,
      accounts,
      tournaments,
      ratings,
      games,
      run,
      close,
    };
  } catch (e) {
    clearInterval(timer);
    if (io) await new Promise((resolve) => io.close(resolve));
    await db.close();
    throw e;
  }
}
module.exports = { createSqlServer };

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const session = require("express-session");
const { insert, json, date } = require("./database");
const { DomainError, requireThat } = require("../tournaments/errors");
const scrypt = promisify(crypto.scrypt);
async function hashPassword(password) {
  requireThat(
    typeof password === "string" &&
      password.length >= 1 &&
      Buffer.byteLength(password) <= 1024,
    "INVALID_PASSWORD",
    "Password must be 1–1024 bytes",
    400,
  );
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return "scrypt$32768$8$1$" + salt + "$" + hash.toString("base64url");
}
async function verifyPassword(password, encoded) {
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password) > 1024 ||
    typeof encoded !== "string"
  )
    return false;
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join("$") !== "scrypt$32768$8$1" ||
    !/^[\w-]{22}$/.test(parts[4]) ||
    !/^[\w-]{43}$/.test(parts[5])
  )
    return false;
  const actual = await scrypt(password, parts[4], 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, Buffer.from(parts[5], "base64url"));
}
class Accounts {
  constructor(uow) {
    this.uow = uow;
  }
  async findByUsername(username, c) {
    if (typeof username !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(username))
      return null;
    const read = async (connection) => {
      const [rows] = await connection.execute(
        "SELECT * FROM player WHERE username=?",
        [username],
      );
      return rows[0] ?? null;
    };
    return c ? read(c) : this.uow.run((tx) => read(tx.c), { readOnly: true });
  }
  async create(username, password) {
    requireThat(
      typeof username === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(username),
      "INVALID_USERNAME",
      "Invalid username",
      400,
    );
    const hash = await hashPassword(password);
    return this.uow.run(async (tx) => {
      const id = crypto.randomUUID();
      await insert(tx.c, "player", {
        player_id: id,
        first_name: username.slice(0, 25),
        last_name: "",
        username,
        _password: hash,
      });
      return { id, username };
    });
  }
}
class SqlSessionStore extends session.Store {
  constructor(uow) {
    super();
    this.uow = uow;
  }
  get(sid, callback) {
    this.uow
      .run(
        async (tx) => {
          const [rows] = await tx.c.execute(
            "SELECT s.session_data FROM auth_session s LEFT JOIN player p ON p.player_id=s.player_id WHERE s.session_id=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND (s.player_id IS NULL OR p.account_status='ACTIVE')",
            [sid],
          );
          return rows[0] ? json(rows[0].session_data) : null;
        },
        { readOnly: true },
      )
      .then((v) => callback(null, v), callback);
  }
  set(sid, value, callback = () => {}) {
    this.uow
      .run(async (tx) => {
        const [rows] = await tx.c.execute(
          "SELECT revoked_at FROM auth_session WHERE session_id=? FOR UPDATE",
          [sid],
        );
        if (rows[0]?.revoked_at)
          throw new DomainError("SESSION_REVOKED", "Session was revoked", 401);
        const expires = date(
          value.cookie?.expires
            ? new Date(value.cookie.expires).getTime()
            : Date.now() + 86400000,
        );
        if (rows.length)
          await tx.c.execute(
            "UPDATE auth_session SET player_id=?,session_data=?,expires_at=?,last_seen_at=UTC_TIMESTAMP(3) WHERE session_id=? AND revoked_at IS NULL",
            [value.playerId ?? null, JSON.stringify(value), expires, sid],
          );
        else
          await insert(tx.c, "auth_session", {
            session_id: sid,
            player_id: value.playerId ?? null,
            session_data: JSON.stringify(value),
            expires_at: expires,
          });
      })
      .then(() => callback(null), callback);
  }
  touch(sid, value, callback = () => {}) {
    this.uow
      .run(async (tx) => {
        await tx.c.execute(
          "UPDATE auth_session SET expires_at=?,last_seen_at=UTC_TIMESTAMP(3) WHERE session_id=? AND revoked_at IS NULL",
          [date(new Date(value.cookie.expires).getTime()), sid],
        );
      })
      .then(() => callback(null), callback);
  }
  destroy(sid, callback = () => {}) {
    this.uow
      .run(async (tx) => {
        await tx.c.execute(
          "UPDATE auth_session SET revoked_at=UTC_TIMESTAMP(3) WHERE session_id=?",
          [sid],
        );
      })
      .then(() => callback(null), callback);
  }
}
module.exports = { Accounts, SqlSessionStore, hashPassword, verifyPassword };

const mysql = require("mysql2/promise");
const { DomainError } = require("../tournaments/errors");
const { connectionOptions } = require("../../database/tools/connection");

const json = (value) =>
  value == null ? null : typeof value === "string" ? JSON.parse(value) : value;
const date = (value) =>
  value == null
    ? null
    : new Date(value).toISOString().replace("T", " ").replace("Z", "");
const millis = (value) =>
  value == null
    ? null
    : value instanceof Date
      ? value.getTime()
      : Date.parse(value.replace(" ", "T") + "Z");
function number(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new Error("Database integer exceeds safe application range");
  return result;
}
async function insert(c, table, values) {
  const keys = Object.keys(values);
  await c.execute(
    "INSERT INTO `" +
      table +
      "` (" +
      keys.map((k) => "`" + k + "`").join(",") +
      ") VALUES (" +
      keys.map(() => "?").join(",") +
      ")",
    Object.values(values),
  );
}
class UnitOfWork {
  constructor(pool, { clock, available = () => true } = {}) {
    this.pool = pool;
    this.clock = clock;
    this.available = available;
  }
  async run(fn, { readOnly = false, snapshot = false } = {}) {
    if (!this.available())
      throw new DomainError(
        "DATABASE_UNAVAILABLE",
        "Database runtime is not ready",
        503,
      );
    for (let attempt = 0; ; attempt++) {
      const c = await this.pool.getConnection().catch(() => {
        throw new DomainError(
          "DATABASE_UNAVAILABLE",
          "Database unavailable",
          503,
        );
      });
      let committing = false;
      try {
        await c.query("SET SESSION time_zone='+00:00'");
        await c.query(
          "SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
        );
        await c.query(
          "SET TRANSACTION ISOLATION LEVEL " +
            (snapshot ? "REPEATABLE READ" : "READ COMMITTED"),
        );
        await c.query(
          snapshot
            ? "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
            : readOnly
              ? "START TRANSACTION READ ONLY"
              : "START TRANSACTION",
        );
        const tx = {
          c,
          now: async () => {
            if (this.clock) return this.clock();
            const [[row]] = await c.query("SELECT UTC_TIMESTAMP(3) now_value");
            return millis(row.now_value);
          },
        };
        const result = await fn(tx);
        if (!this.available())
          throw new DomainError(
            "DATABASE_UNAVAILABLE",
            "Database runtime lost ownership",
            503,
          );
        committing = true;
        await c.commit();
        return result;
      } catch (error) {
        try {
          await c.rollback();
        } catch {}
        if (committing)
          throw new DomainError(
            "COMMIT_OUTCOME_UNKNOWN",
            "Commit outcome is uncertain; retry the same command ID after reconnecting",
            503,
          );
        if (
          ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code) &&
          attempt < 2
        )
          continue;
        if (error instanceof DomainError) throw error;
        if (
          [
            "ECONNRESET",
            "ECONNREFUSED",
            "PROTOCOL_CONNECTION_LOST",
            "ETIMEDOUT",
          ].includes(error.code)
        )
          throw new DomainError(
            "DATABASE_UNAVAILABLE",
            "Database unavailable",
            503,
          );
        throw error;
      } finally {
        c.release();
      }
    }
  }
}
async function createDatabase(options = {}) {
  if (
    !Number.isSafeInteger(options.connectionLimit ?? 10) ||
    (options.connectionLimit ?? 10) < 2
  ) {
    throw new Error(
      "Connection limit must be at least two (runtime lease plus transaction connection)",
    );
  }
  const config = connectionOptions(
    options.database,
    options.env ?? process.env,
  );
  const pool = mysql.createPool({
    ...config,
    connectionLimit: options.connectionLimit ?? 10,
    waitForConnections: true,
    queueLimit: 100,
    decimalNumbers: false,
  });
  let lease;
  let available = true;
  let timer;
  let checking = false;
  try {
    lease = await pool.getConnection();
    const [[version]] = await lease.query("SELECT VERSION() version");
    if (!/^8\.4\./.test(version.version))
      throw new Error("Backend requires MySQL 8.4 LTS");
    const { migrations } = require("../../database/tools/sql");
    const [rows] = await lease.query(
      "SELECT version,filename,checksum,status FROM schema_migration ORDER BY version",
    );
    const expected = migrations();
    if (
      rows.length !== expected.length ||
      rows.some(
        (row, i) =>
          row.version !== expected[i].version ||
          row.filename !== expected[i].name ||
          row.checksum !== expected[i].checksum ||
          row.status !== "APPLIED",
      )
    )
      throw new Error(
        "Database schema is not current; run reviewed db:migrate before starting the backend",
      );
    const schemaLock = "chess_schema:" + config.database;
    const [[schemaOwner]] = await lease.execute(
      "SELECT GET_LOCK(?,0) acquired",
      [schemaLock],
    );
    if (number(schemaOwner.acquired) !== 1)
      throw new Error(
        "Schema migration is in progress; start the backend after it completes",
      );
    const lock = "chess_runtime:" + config.database;
    const [[owner]] = await lease.execute("SELECT GET_LOCK(?,0) acquired", [
      lock,
    ]);
    if (number(owner.acquired) !== 1)
      throw new Error(
        "Another backend owns this database; single-instance mode required",
      );
    await require("../../database/tools/verify").verify(lease);
    await lease.execute("SELECT RELEASE_LOCK(?)", [schemaLock]);
    lease.on("error", () => {
      available = false;
    });
    timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        await lease.query("SELECT 1");
      } catch {
        available = false;
      } finally {
        checking = false;
      }
    }, 5000);
    timer.unref();
    return {
      pool,
      uow: new UnitOfWork(pool, {
        clock: options.clock,
        available: () => available,
      }),
      isAvailable: () => available,
      close: async () => {
        clearInterval(timer);
        available = false;
        try {
          await lease.execute("SELECT RELEASE_LOCK(?)", [lock]);
        } catch {}
        lease.release();
        await pool.end();
      },
    };
  } catch (error) {
    clearInterval(timer);
    if (lease) lease.release();
    await pool.end();
    throw error;
  }
}
module.exports = {
  createDatabase,
  UnitOfWork,
  insert,
  json,
  date,
  millis,
  number,
};

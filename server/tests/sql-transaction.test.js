const { test } = require("node:test");
const assert = require("node:assert/strict");
const { UnitOfWork } = require("../sql/database");
function fixture({ commitError = false } = {}) {
  const log = [];
  const c = {
    query: async (sql) => {
      log.push(sql);
    },
    commit: async () => {
      log.push("COMMIT");
      if (commitError) throw new Error("connection lost during commit");
    },
    rollback: async () => log.push("ROLLBACK"),
    release: () => log.push("RELEASE"),
  };
  return {
    log,
    uow: new UnitOfWork({ getConnection: async () => c }, { clock: () => 123 }),
  };
}
test("SQL transaction retries deadlocks before commit and releases every borrowed connection", async () => {
  const { log, uow } = fixture();
  let calls = 0;
  const response = await uow.run(async (tx) => {
    assert.equal(await tx.now(), 123);
    if (calls++ === 0)
      throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
    return "accepted";
  });
  assert.equal(response, "accepted");
  assert.equal(calls, 2);
  assert.equal(log.filter((v) => v === "RELEASE").length, 2);
  assert.equal(log.filter((v) => v === "COMMIT").length, 1);
});
test("SQL uncertain commit never retries the callback or acknowledges success", async () => {
  const { log, uow } = fixture({ commitError: true });
  let calls = 0;
  await assert.rejects(
    uow.run(async () => {
      calls++;
      return "accepted";
    }),
    { code: "COMMIT_OUTCOME_UNKNOWN", status: 503 },
  );
  assert.equal(calls, 1);
  assert.equal(log.at(-1), "RELEASE");
});
test("SQL unavailable ownership rejects before borrowing a connection", async () => {
  const uow = new UnitOfWork(
    { getConnection: () => assert.fail("must not borrow") },
    { available: () => false },
  );
  await assert.rejects(
    uow.run(() => assert.fail("must not run")),
    { code: "DATABASE_UNAVAILABLE", status: 503 },
  );
});

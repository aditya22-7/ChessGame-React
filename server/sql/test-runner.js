const { spawnSync } = require("node:child_process");
const path = require("node:path");
// These tests intentionally write fixtures. Require an unmistakable test target.
if (
  !/^chess_[a-z0-9_]*(test|integration)[a-z0-9_]*$/.test(
    process.env.MYSQL_DATABASE ?? "",
  ) ||
  !process.env.MYSQL_PORT ||
  !process.env.MYSQL_USER
) {
  console.error(
    "Set explicit MYSQL_DATABASE (chess_*test* or chess_*integration*), MYSQL_PORT and MYSQL_USER for a disposable migrated MySQL 8.4 test database. No tests were run.",
  );
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    ["--test", path.join(__dirname, "integration.test.js")],
    { env: { ...process.env, SQL_INTEGRATION: "1" }, stdio: "inherit" },
  );
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}

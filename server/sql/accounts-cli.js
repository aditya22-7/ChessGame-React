const fs = require("node:fs");
const path = require("node:path");
const { createDatabase } = require("./database");
const { Accounts, hashPassword } = require("./accounts");

async function main() {
  const [action, username] = process.argv.slice(2);
  if (action === "--help") {
    console.log(
      "create <username>: read password from CHESS_ACCOUNT_PASSWORD\nimport-users: explicitly import server/users/*.json accounts, hashing passwords; refuse conflicts. No game/rating/checkpoint import.",
    );
    return;
  }
  if (
    !["create", "import-users"].includes(action) ||
    process.argv.length > (action === "create" ? 4 : 3)
  )
    throw new Error("Use --help for supported commands");
  const db = await createDatabase();
  try {
    const accounts = new Accounts(db.uow);
    if (action === "create") {
      await accounts.create(username, process.env.CHESS_ACCOUNT_PASSWORD);
      console.log("Account created");
      return;
    }
    const root = path.resolve(__dirname, "../users"),
      records = [];
    for (const file of fs
      .readdirSync(root)
      .filter((f) => f.endsWith(".json"))) {
      const name = file.slice(0, -5),
        data = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name))
        throw new Error("Invalid source username");
      records.push({ name, password: await hashPassword(data.password) });
    }
    // All-or-nothing. Existing accounts are never overwritten, reset, or matched
    // heuristically to a legacy player's identity.
    await db.uow.run(async (tx) => {
      for (const r of records) {
        if (await accounts.findByUsername(r.name, tx.c))
          throw new Error(
            "An imported username already exists; resolve account ownership before importing",
          );
        await tx.c.execute(
          "INSERT INTO player(player_id,username,_password) VALUES(UUID(),?,?)",
          [r.name, r.password],
        );
      }
    });
    console.log(
      "Imported " +
        records.length +
        " accounts with password hashes. Existing JSON files were retained.",
    );
  } finally {
    await db.close();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };

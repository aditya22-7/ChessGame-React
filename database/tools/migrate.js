const fs = require('node:fs');
const path = require('node:path');
const { migrations, root } = require('./sql');
const { connect } = require('./connection');
const { preflight } = require('./preflight');
const { legacyShape } = require('./legacy-shape');
const { journalDDL } = require('./journal');

async function adopt(connection, baseline) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'legacy-manifest.json')));
  const [tables] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'schema_migration'");
  if (tables.length !== manifest.tables.length || manifest.tables.some(t => !tables.some(row => row.TABLE_NAME === t))) throw new Error('Legacy adoption requires exactly the supplied game tables, without unrelated tables');
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'legacy-shape.json')));
  if (JSON.stringify(await legacyShape(connection)) !== JSON.stringify(expected)) throw new Error('Legacy columns, indexes or foreign keys differ from the supplied schema');
  await preflight(connection);
  await connection.execute("INSERT INTO schema_migration(version,filename,checksum,status,finished_at) VALUES (?,?,?,'APPLIED',UTC_TIMESTAMP(3))", [baseline.version, baseline.name, baseline.checksum]);
}
async function migrate(connection, { adoptLegacy = false, stopAfter } = {}) {
  const files = migrations(); // Validate the local migration set before any DDL.
  const [[db]] = await connection.query('SELECT DATABASE() db');
  const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 5) acquired', ['chess_schema:' + db.db]);
  if (Number(lock.acquired) !== 1) throw new Error('Another schema migration owns this database');
  try {
    const [[runtime]] = await connection.execute('SELECT IS_USED_LOCK(?) owner_id', ['chess_runtime:' + db.db]);
    if (runtime.owner_id !== null) throw new Error('Stop the backend before migrating this database');
    const [before] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
    const hadJournal = before.some(t => t.TABLE_NAME === 'schema_migration');
    if (!hadJournal && before.length && !adoptLegacy) throw new Error('Nonempty database refused. Back up and use --adopt-legacy only for the reviewed supplied schema');
    await connection.query(journalDDL);
    const [[journalSize]] = await connection.query('SELECT COUNT(*) n FROM schema_migration');
    const hasLegacyTables = before.some(t => t.TABLE_NAME !== 'schema_migration');
    if (Number(journalSize.n)===0 && hasLegacyTables) {
      if (!adoptLegacy) throw new Error('Existing untracked schema refused; explicit reviewed legacy adoption required');
      await adopt(connection, files[0]);
    }
    const [journal] = await connection.query('SELECT * FROM schema_migration ORDER BY version');
    for (const [index, row] of journal.entries()) {
      const file = files.find(f => f.version === row.version);
      if (!file || row.checksum !== file.checksum || row.filename !== file.name) throw new Error('Migration checksum/name mismatch: ' + row.version);
      if (row.version !== files[index]?.version) throw new Error('Migration history is not a contiguous prefix');
      if (row.status !== 'APPLIED') throw new Error('Incomplete DDL migration requires manual recovery: ' + row.version);
    }
    for (const migration of files) {
      if (stopAfter && migration.version > stopAfter) break;
      if (journal.some(row => row.version === migration.version)) continue;
      if (migration.version === '002') await preflight(connection);
      await connection.execute("INSERT INTO schema_migration(version,filename,checksum,status) VALUES (?,?,?,'RUNNING')", [migration.version, migration.name, migration.checksum]);
      try {
        for (const statement of migration.statements) await connection.query(statement);
        await connection.execute("UPDATE schema_migration SET status='APPLIED',finished_at=UTC_TIMESTAMP(3) WHERE version=?", [migration.version]);
      } catch (error) {
        await connection.execute("UPDATE schema_migration SET status='FAILED',failure_code=? WHERE version=?", [error.code ?? 'DDL_ERROR', migration.version]);
        throw new Error(`Migration ${migration.name} failed (${error.code ?? 'DDL_ERROR'}): ${error.message}`);
      }
    }
  } finally { await connection.execute('SELECT RELEASE_LOCK(?)', ['chess_schema:' + db.db]); }
}
function parseArguments(args) {
  if (args.some(arg=>!['--adopt-legacy','--help'].includes(arg)) || new Set(args).size!==args.length) throw new Error('Unsupported migration option. Allowed: --adopt-legacy, --help. There is no implicit dry-run or force mode');
  return {adoptLegacy:args.includes('--adopt-legacy'),help:args.includes('--help')};
}
if (require.main === module) {
  (async () => {
    const options=parseArguments(process.argv.slice(2));
    if(options.help) {console.log('Usage: npm run db:migrate -- [--adopt-legacy]\nSet MYSQL_DATABASE and connection environment variables explicitly. Existing untracked databases are refused by default.');return;}
    const connection = await connect(); try { await migrate(connection, options); console.log('Schema migrations verified/applied'); } finally { await connection.end(); }
  })()
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { migrate, parseArguments };

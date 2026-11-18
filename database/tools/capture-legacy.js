const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./connection');
const { legacyShape } = require('./legacy-shape');
const { root } = require('./sql');
if (require.main === module) (async () => {
  const connection = await connect();
  try {
    const [journal] = await connection.query('SELECT version,status FROM schema_migration ORDER BY version');
    if (journal.length!==1 || journal[0].version!=='001' || journal[0].status!=='APPLIED') throw new Error('Capture requires a clean scratch database with ONLY baseline migration 001 applied');
    fs.writeFileSync(path.join(root,'legacy-shape.json'), JSON.stringify(await legacyShape(connection),null,2)+'\n');
    console.log('Captured schema metadata only (no account data)');
  } finally { await connection.end(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});

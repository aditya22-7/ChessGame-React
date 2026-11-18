const { connect } = require('./connection');
const { migrations } = require('./sql');
async function verify(connection) {
  const [journal] = await connection.query('SELECT version,filename,checksum,status FROM schema_migration ORDER BY version');
  const files = migrations();
  if (journal.length!==files.length || journal.some((row,i)=>row.version!==files[i].version || row.filename!==files[i].name || row.checksum!==files[i].checksum || row.status!=='APPLIED')) throw new Error('Migration journal does not match the complete checked-in schema');
  const [issues] = await connection.query('SELECT * FROM v_schema_integrity_issues ORDER BY issue_code,entity_id');
  const [unenforced] = await connection.query("SELECT TABLE_NAME,CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK' AND ENFORCED<>'YES'");
  if (unenforced.length) throw new Error('Unenforced CHECK constraints found');
  if (issues.length) throw new Error('Committed integrity issues:\n'+issues.map(i=>i.issue_code+': '+i.entity_id).join('\n'));
  const [[counts]] = await connection.query("SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE') tables_count,(SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()) foreign_keys,(SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) triggers_count");
  return { ...counts, migrations: journal.length, integrityIssues: issues.length };
}
if (require.main===module) (async()=>{const c=await connect();try{console.log(JSON.stringify(await verify(c),null,2));}finally{await c.end();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = { verify };

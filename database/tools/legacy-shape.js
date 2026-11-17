async function legacyShape(connection) {
  const [tableRows] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'schema_migration' ORDER BY TABLE_NAME");
  const columns = {};
  for (const { TABLE_NAME: table } of tableRows) {
    const [rows] = await connection.query('SHOW FULL COLUMNS FROM `' + table.replaceAll('`','``') + '`');
    columns[table] = rows.map(c => ({ name: c.Field, type: c.Type, nullable: c.Null, collation: c.Collation, key: c.Key, default: c.Default, extra: c.Extra }));
  }
  const [foreignKeys] = await connection.query(`SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`);
  const [indexes] = await connection.query(`SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,COLLATION,INDEX_TYPE,IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME<>'schema_migration' ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`);
  return { columns, foreignKeys, indexes };
}
module.exports = { legacyShape };

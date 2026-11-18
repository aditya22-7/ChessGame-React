const mysql = require('mysql2/promise');
function databaseName(value) {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(value ?? '')) throw new Error('Specify MYSQL_DATABASE using 1–32 lowercase letters/digits/underscores');
  return value;
}
function portNumber(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value)<1 || Number(value)>65535) throw new Error('MySQL port must be an integer between 1 and 65535');
  return Number(value);
}
function connectionOptions(database, env = process.env) {
  const host=env.MYSQL_HOST??'127.0.0.1',user=env.MYSQL_USER??'root';
  if (!host.trim() || !user.trim()) throw new Error('MySQL host and user must be nonempty');
  return {host,port:portNumber(env.MYSQL_PORT??3306),user,password:env.MYSQL_PASSWORD??'',
    database:databaseName(database??env.MYSQL_DATABASE),connectTimeout:10000,
    multipleStatements:false,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true};
}
async function connect(database, {env=process.env,driver=mysql}={}) {
  const connection = await driver.createConnection(connectionOptions(database,env));
  try {
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    const [[version]] = await connection.query('SELECT VERSION() AS version');
    if (!/^8\.4\./.test(version.version)) throw new Error('Schema tooling requires MySQL 8.4 LTS; MariaDB is not a substitute');
    return connection;
  } catch(error) {
    try { await connection.end(); } catch { /* Preserve the original setup failure. */ }
    throw error;
  }
}
module.exports = { connect, databaseName, portNumber, connectionOptions };

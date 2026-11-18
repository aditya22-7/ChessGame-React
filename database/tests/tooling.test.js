const test=require('node:test');
const assert=require('node:assert/strict');
const {connect,connectionOptions,databaseName}=require('../tools/connection');
const {validateMigrationOrder}=require('../tools/sql');
const {testEnvironment}=require('../tools/test-integration');
const {parseArguments}=require('../tools/migrate');

test('connection configuration rejects invalid targets before opening a socket',async()=>{
  for(const value of ['',undefined,'game; DROP DATABASE game','game-prod','../game']) assert.throws(()=>databaseName(value));
  for(const value of ['abc','0','65536','3306.1','-1','']) assert.throws(()=>connectionOptions('game',{MYSQL_PORT:value}));
  const options=connectionOptions('game',{MYSQL_PORT:'3306',MYSQL_USER:'migration',MYSQL_PASSWORD:'secret'});
  assert.equal(options.port,3306);assert.equal(options.multipleStatements,false);assert.equal(options.dateStrings,true);
  assert.equal(options.supportBigNumbers,true);assert.equal(options.bigNumberStrings,true);
  let called=false;
  await assert.rejects(connect('bad-name',{env:{},driver:{createConnection:async()=>{called=true;}}}),/MYSQL_DATABASE/);
  assert.equal(called,false);
});
test('failed connection initialization closes the borrowed connection',async()=>{
  let closed=0;
  await assert.rejects(connect('game',{env:{},driver:{createConnection:async()=>({query:async()=>{throw new Error('setup failed');},end:async()=>{closed++;}})}}),/setup failed/);
  assert.equal(closed,1);
});
test('unsupported server versions close connections and successful setup preserves ownership',async()=>{
  for(const version of ['8.0.36','9.0.0','10.11.0-MariaDB']) {
    let closed=0;
    await assert.rejects(connect('game',{env:{},driver:{createConnection:async()=>({query:async()=>[[{version}]],end:async()=>{closed++;}})}}),/8\.4 LTS/);
    assert.equal(closed,1);
  }
  const statements=[];let closed=0;
  const connection={query:async sql=>{statements.push(sql);return [[{version:'8.4.13'}]];},end:async()=>{closed++;}};
  assert.equal(await connect('game',{env:{},driver:{createConnection:async()=>connection}}),connection);
  assert.equal(closed,0);assert.match(statements[0],/time_zone/);assert.match(statements[1],/STRICT_TRANS_TABLES/);
});
test('migration ordering rejects missing, duplicate, and out-of-order versions',()=>{
  for(const versions of [[],['002'],['001','003'],['001','001'],['002','001']]) assert.throws(()=>validateMigrationOrder(versions.map(version=>({version}))),/contiguous/);
  assert.doesNotThrow(()=>validateMigrationOrder([{version:'001'},{version:'002'}]));
});
test('explicit live-test command cannot silently skip tests or default to an application database',()=>{
  assert.throws(()=>testEnvironment({MYSQL_DATABASE:'game'}),/no tests were run/);
  assert.throws(()=>testEnvironment({MYSQL_TEST_PORT:'invalid',MYSQL_TEST_USER:'test'}),/port/);
  const env=testEnvironment({MYSQL_TEST_PORT:'33379',MYSQL_TEST_USER:'test',MYSQL_SCHEMA_TEST:'0'});
  assert.equal(env.MYSQL_SCHEMA_TEST,'1');assert.equal(env.MYSQL_DATABASE,undefined);
});
test('migration CLI rejects unknown write options before connecting and help needs no database',()=>{
  assert.throws(()=>parseArguments(['--dry-run']),/no implicit dry-run/);
  assert.throws(()=>parseArguments(['--force']),/Unsupported migration option/);
  assert.throws(()=>parseArguments(['--adopt-legacy','--adopt-legacy']),/Unsupported migration option/);
  assert.deepEqual(parseArguments(['--adopt-legacy']),{adoptLegacy:true,help:false});
  const {spawnSync}=require('node:child_process');
  const path=require('node:path');
  const child=spawnSync(process.execPath,[path.join(__dirname,'../tools/migrate.js'),'--help'],{encoding:'utf8',env:{...process.env,MYSQL_DATABASE:''}});
  assert.equal(child.status,0);assert.match(child.stdout,/Usage:/);
});

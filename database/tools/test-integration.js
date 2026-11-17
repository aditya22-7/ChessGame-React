const { spawnSync }=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {portNumber}=require('./connection');
const {root}=require('./sql');
function testEnvironment(env) {
  if (!env.MYSQL_TEST_PORT || !env.MYSQL_TEST_USER?.trim()) throw new Error('Live tests require explicit MYSQL_TEST_PORT and MYSQL_TEST_USER for a dedicated MySQL 8.4 test instance; no tests were run');
  portNumber(env.MYSQL_TEST_PORT);
  return {...env,MYSQL_SCHEMA_TEST:'1'};
}
if(require.main===module) {
  try {
    const env=testEnvironment(process.env);
    const files=fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.js')).sort().map(f=>path.join(root,'tests',f));
    const child=spawnSync(process.execPath,['--test',...files],{env,stdio:'inherit'});
    if(child.error) throw child.error;
    process.exitCode=child.status??1;
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
module.exports={testEnvironment};

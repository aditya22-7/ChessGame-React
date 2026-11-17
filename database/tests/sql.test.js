const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitSql, migrations, root } = require('../tools/sql');
test('SQL splitter respects strings, escaped delimiters and trigger bodies',()=>{
  const source="-- comment;\nSELECT 'a;''b', `semi;colon`;\nDELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 'x$$y'; SELECT 2; END$$\nDELIMITER ;\nSELECT 3;";
  const rows=splitSql(source); assert.equal(rows.length,3); assert.match(rows[1],/SELECT 2; END/);
  assert.throws(()=>splitSql("SELECT 'unfinished;"),/Unterminated/);
  assert.throws(()=>splitSql('SELECT 1'),/final delimiter/);
});
test('migrations are contiguous and never contain destructive dump directives',()=>{
  const files=migrations(); assert.equal(files.length,6);
  files.forEach((file,i)=>{
    assert.equal(file.version,String(i+1).padStart(3,'0'));
    assert.ok(file.statements.length>0);
    for(const statement of file.statements) assert.doesNotMatch(statement,/^(?:DROP\s|TRUNCATE\s|SET\s+(?:SESSION\s+)?FOREIGN_KEY_CHECKS\s*=\s*0)/i);
  });
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'legacy-manifest.json')));
  const tables=files[0].statements.map(s=>s.match(/^CREATE TABLE `([^`]+)`/)[1]);
  assert.deepEqual(tables,manifest.tables);
});
test('standalone schema is generated from the same migrations',()=>{
  const { execFileSync }=require('node:child_process');
  execFileSync(process.execPath,[path.join(root,'tools/build.js'),'--check']);
});

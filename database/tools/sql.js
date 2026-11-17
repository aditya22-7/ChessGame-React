const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

// MySQL client DELIMITER support, without executing comments or splitting quoted
// semicolons. No stored-data dumps or client SOURCE commands are accepted.
function splitSql(sql) {
  const statements = [];
  let delimiter = ';', buffer = '', quote = null, block = false, line = false, lineStart = true;
  for (let i = 0; i < sql.length;) {
    const c = sql[i], next = sql[i + 1];
    if (!quote && !block && !line && lineStart) {
      const directive = sql.slice(i).match(/^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(?:\r?\n|$)/i);
      if (directive) {
        if (buffer.trim()) throw new Error('DELIMITER inside an unfinished statement');
        delimiter = directive[1]; i += directive[0].length; continue;
      }
    }
    if (line) { if (c === '\n') { line = false; buffer += '\n'; lineStart = true; } i++; continue; }
    if (block) { if (c === '*' && next === '/') { block = false; buffer += ' '; i += 2; } else i++; continue; }
    if (quote) {
      buffer += c;
      if (c === '\\') { if (next !== undefined) buffer += next; i += 2; continue; }
      if (c === quote) { if (next === quote) { buffer += next; i += 2; continue; } quote = null; }
      lineStart = c === '\n'; i++; continue;
    }
    if (c === '-' && next === '-' && /\s/.test(sql[i + 2] ?? '')) { line = true; i += 2; continue; }
    if (c === '#') { line = true; i++; continue; }
    if (c === '/' && next === '*') { block = true; i += 2; continue; }
    if (sql.startsWith(delimiter, i)) {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = ''; i += delimiter.length; lineStart = false; continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    buffer += c; lineStart = c === '\n'; i++;
  }
  if (quote || block) throw new Error('Unterminated SQL string or comment');
  if (buffer.trim()) throw new Error('SQL statement lacks final delimiter');
  return statements;
}
function migrations() {
  const files = fs.readdirSync(path.join(root, 'migrations')).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort().map(name => {
    const sql = fs.readFileSync(path.join(root, 'migrations', name), 'utf8');
    return { version: name.slice(0, 3), name, sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex'), statements: splitSql(sql) };
  });
  validateMigrationOrder(files);
  return files;
}
function validateMigrationOrder(files) {
  if (!files.length || files.some((file,index)=>file.version!==String(index+1).padStart(3,'0'))) throw new Error('Migration files must be a nonempty contiguous sequence starting at 001, without duplicate versions');
}
module.exports = { root, splitSql, migrations, validateMigrationOrder };

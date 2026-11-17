const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const emptyState = () => ({ schemaVersion: 1, tournaments: {}, sessions: {}, eventSequence: 0, outbox: [] });

/** Single-process transaction port. Callbacks must be synchronous and side-effect free.
 * Database adapters must preserve serializable transactions and detached return values.
 */
class MemoryStore {
  constructor(state = emptyState()) { this.state = structuredClone(state); }
  read(fn) { return structuredClone(fn(structuredClone(this.state))); }
  transaction(fn) {
    const next = structuredClone(this.state);
    const result = fn(next);
    if (result && typeof result.then === 'function') throw new Error('Async transaction callback is not supported');
    const detached = structuredClone(result);
    this.commit(next);
    this.state = next;
    return detached;
  }
  commit() {}
  close() {}
}

/** Atomic checkpoint adapter for one backend process, on a local filesystem. */
class FileStore extends MemoryStore {
  constructor(filename) {
    super();
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.lockfile = this.filename + '.lock';
    this.token = randomUUID();
    this.acquireLock();
    try {
      if (fs.existsSync(this.filename)) {
        const state = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
        if (state.schemaVersion !== 1 || !state.tournaments || !state.sessions || !Array.isArray(state.outbox)) {
          throw new Error('Invalid tournament checkpoint; refusing to overwrite it');
        }
        this.state = state;
      } else this.commit(this.state);
    } catch (error) { this.close(); throw error; }
  }
  acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(this.lockfile, JSON.stringify({ pid: process.pid, token: this.token }), { flag: 'wx' });
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = JSON.parse(fs.readFileSync(this.lockfile, 'utf8'));
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('Tournament storage is already owned by another process');
        fs.unlinkSync(this.lockfile);
      }
    }
    throw new Error('Could not acquire tournament storage lock');
  }
  commit(next) {
    const temporary = this.filename + '.' + this.token + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temporary, 'w');
      fs.writeFileSync(fd, JSON.stringify(next));
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.filename);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  close() {
    if (fs.existsSync(this.lockfile)) {
      const owner = JSON.parse(fs.readFileSync(this.lockfile, 'utf8'));
      if (owner.token === this.token) fs.unlinkSync(this.lockfile);
    }
  }
}
module.exports = { MemoryStore, FileStore, emptyState };

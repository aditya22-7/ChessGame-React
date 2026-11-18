const session = require('express-session');

class PersistentSessionStore extends session.Store {
  constructor(store) { super(); this.store = store; }
  get(sid, callback) {
    try {
      const record = this.store.read(s => s.sessions[sid]);
      callback(null, record && record.expiresAt > Date.now() ? record.value : null);
    } catch (error) { callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try {
      const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
      this.store.transaction(s => { s.sessions[sid] = { value, expiresAt }; });
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { this.store.transaction(s => { delete s.sessions[sid]; }); callback(null); }
    catch (error) { callback(error); }
  }
  touch(sid, value, callback) { this.set(sid, value, callback); }
}
module.exports = { PersistentSessionStore };

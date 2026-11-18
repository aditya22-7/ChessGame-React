/** Deadlines are derived from persisted schedules/session state, not timer handles.
 * Timer polling is merely a wake-up mechanism. Commands also reconcile due work.
 */
class DeadlineWorker {
  constructor(service, deliver, { pollIntervalMs = 250, onError = console.error } = {}) {
    this.service = service; this.deliver = deliver; this.onError = onError;
    this.pollIntervalMs = pollIntervalMs; this.timer = null; this.running = false;
  }
  run() {
    if (this.running) return;
    this.running = true;
    try { this.service.tick(); this.service.flushEvents(this.deliver); }
    catch (error) { this.onError('Tournament worker failed:', error); }
    finally { this.running = false; }
  }
  start() {
    if (!this.timer) { this.timer = setInterval(() => this.run(), this.pollIntervalMs); this.timer.unref(); }
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
module.exports = { DeadlineWorker };

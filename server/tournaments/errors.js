class DomainError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function requireThat(condition, code, message, status) {
  if (!condition) throw new DomainError(code, message, status);
}
module.exports = { DomainError, requireThat };

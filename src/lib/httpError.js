// The one way services report a failure the client should see.
// The central error handler turns it into: status + {"error": message}.
// `headers` is optional, e.g. { 'Retry-After': '30' } on a 429.

export class HttpError extends Error {
  constructor(status, message, headers = undefined) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

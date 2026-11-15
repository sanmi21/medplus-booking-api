// The one way services report a failure the client should see.
// The central error handler turns it into: status + {"error": message}.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

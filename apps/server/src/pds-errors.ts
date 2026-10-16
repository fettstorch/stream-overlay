export class CloudConfigMissingError extends Error {}
export class ChatPermissionRequiredError extends Error {}
export class ChatRateLimitError extends Error {}
export class CloudConfigConflictError extends Error {
  constructor() {
    super("The configuration changed since it was loaded. Reload before saving.");
  }
}

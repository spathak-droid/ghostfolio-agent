/**
 * AppError: Typed base class for application-level errors.
 * Extends Error with semantic properties for error classification and recovery.
 */
export class AppError extends Error {
  public readonly cause?: Error;

  constructor(
    public readonly code: string,
    message: string,
    public readonly recoverable: boolean = false,
    cause?: Error
  ) {
    super(message);
    this.name = 'AppError';
    this.cause = cause;
  }
}

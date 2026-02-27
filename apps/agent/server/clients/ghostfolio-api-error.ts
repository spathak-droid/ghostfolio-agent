export type GhostfolioApiErrorCode =
  | 'GHOSTFOLIO_HTTP_ERROR'
  | 'GHOSTFOLIO_EMPTY_BODY'
  | 'GHOSTFOLIO_INVALID_JSON'
  | 'GHOSTFOLIO_TIMEOUT'
  | 'GHOSTFOLIO_NETWORK_ERROR';

export class GhostfolioApiError extends Error {
  public readonly code: GhostfolioApiErrorCode;
  public readonly method: 'GET' | 'POST' | 'PUT';
  public readonly path: string;
  public readonly retryable: boolean;
  public readonly status?: number;

  public constructor(params: {
    code: GhostfolioApiErrorCode;
    message: string;
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    status?: number;
    retryable: boolean;
  }) {
    super(params.message);
    this.name = 'GhostfolioApiError';
    this.code = params.code;
    this.method = params.method;
    this.path = params.path;
    this.retryable = params.retryable;
    this.status = params.status;
  }
}

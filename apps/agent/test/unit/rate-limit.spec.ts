import { createRateLimitMiddleware } from '../../server/http/rate-limit';

function createMockResponse() {
  const response = {
    json: jest.fn(),
    status: jest.fn()
  } as unknown as {
    status: jest.Mock;
    json: jest.Mock;
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('createRateLimitMiddleware', () => {
  it('allows requests within limit and rejects when exceeded', () => {
    let nowMs = 1_000;
    const limiter = createRateLimitMiddleware({
      keyFn: () => 'ip:test',
      maxRequests: 2,
      nowFn: () => nowMs,
      windowMs: 60_000
    });

    const request = { ip: '127.0.0.1' } as { ip: string };
    const response = createMockResponse();
    const next = jest.fn();

    limiter(request as never, response as never, next as never);
    limiter(request as never, response as never, next as never);
    limiter(request as never, response as never, next as never);

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'RATE_LIMITED'
      })
    );

    nowMs += 60_001;
    limiter(request as never, response as never, next as never);
    expect(next).toHaveBeenCalledTimes(3);
  });
});

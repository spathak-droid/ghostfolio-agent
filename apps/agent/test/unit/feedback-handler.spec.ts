import { createFeedbackHandler } from '../../server/http/feedback-handler';

function createMockResponse() {
  const response = {
    json: jest.fn(),
    status: jest.fn()
  } as unknown as {
    json: jest.Mock;
    status: jest.Mock;
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('createFeedbackHandler', () => {
  it('does not expose raw internal error messages on persistence exceptions', async () => {
    const handler = createFeedbackHandler({
      feedbackStore: {
        save: jest.fn().mockRejectedValue(new Error('database password=secret123'))
      }
    });

    const request = {
      body: {
        answer: 'Answer',
        conversationId: 'conv-1',
        rating: 'up'
      }
    };
    const response = createMockResponse();

    await handler(request as never, response as never);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      code: 'FEEDBACK_PERSIST_FAILED',
      error: 'feedback_persist_failed'
    });
  });
});

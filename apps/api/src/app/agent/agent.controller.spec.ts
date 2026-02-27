import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentChatResponse } from './agent.types';

describe('AgentController', () => {
  it('forwards request body and authorization header to service', async () => {
    const chatMock = jest.fn().mockResolvedValue({
      answer: 'Portfolio analysis: Diversified.',
      conversation: [
        { role: 'user', content: 'Analyze my portfolio allocation' },
        { role: 'assistant', content: 'Portfolio analysis: Diversified.' }
      ],
      errors: [],
      toolCalls: [
        {
          toolName: 'portfolio_analysis',
          success: true,
          result: { allocation: [] }
        }
      ],
      verification: {
        confidence: 0.82,
        isValid: true
      }
    } satisfies AgentChatResponse);

    const agentService = {
      chat: chatMock
    } as unknown as AgentService;

    const controller = new AgentController(agentService);

    await controller.chat(
      {
        conversationId: 'conv-1',
        message: 'Analyze my portfolio allocation'
      },
      'Bearer jwt-token'
    );

    expect(chatMock).toHaveBeenCalledWith(
      {
        conversationId: 'conv-1',
        message: 'Analyze my portfolio allocation'
      },
      'Bearer jwt-token',
      undefined
    );
  });

  it('uses body accessToken when Authorization header is missing', async () => {
    const chatMock = jest.fn().mockResolvedValue({
      answer: 'Ok',
      conversation: [],
      errors: [],
      toolCalls: [],
      verification: { confidence: 0.5, isValid: true }
    } satisfies AgentChatResponse);

    const controller = new AgentController({
      chat: chatMock
    } as unknown as AgentService);

    await controller.chat(
      {
        conversationId: 'c-1',
        message: 'Hi',
        accessToken: 'raw-jwt-token'
      },
      undefined,
      undefined
    );

    expect(chatMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c-1', message: 'Hi' }),
      'Bearer raw-jwt-token',
      undefined
    );
  });

  it('proxies widget asset responses', async () => {
    const agentService = {
      fetchWidgetAsset: jest.fn().mockResolvedValue({
        body: Buffer.from('console.log("widget")'),
        contentType: 'text/javascript; charset=utf-8',
        status: 200
      })
    } as unknown as AgentService;

    const responseMock = {
      send: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn()
    };
    responseMock.status.mockReturnValue(responseMock);

    const controller = new AgentController(agentService);

    await controller.widgetAssetSingle('index.js', responseMock as never);

    expect(agentService.fetchWidgetAsset).toHaveBeenCalledWith('index.js');
    expect(responseMock.status).toHaveBeenCalledWith(200);
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/javascript; charset=utf-8'
    );
    expect(responseMock.send).toHaveBeenCalledWith(
      Buffer.from('console.log("widget")')
    );
  });

  it('proxies nested widget asset responses', async () => {
    const agentService = {
      fetchWidgetAsset: jest.fn().mockResolvedValue({
        body: Buffer.from('<svg/>'),
        contentType: 'image/svg+xml',
        status: 200
      })
    } as unknown as AgentService;

    const responseMock = {
      send: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn()
    };
    responseMock.status.mockReturnValue(responseMock);

    const controller = new AgentController(agentService);

    await controller.widgetAssetNested('asset', 'ghost.svg', responseMock as never);

    expect(agentService.fetchWidgetAsset).toHaveBeenCalledWith('asset/ghost.svg');
    expect(responseMock.status).toHaveBeenCalledWith(200);
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/svg+xml'
    );
    expect(responseMock.send).toHaveBeenCalledWith(Buffer.from('<svg/>'));
  });

  it('forwards feedback payload and authorization header to service', async () => {
    const feedbackMock = jest.fn().mockResolvedValue({ ok: true });
    const controller = new AgentController({
      feedback: feedbackMock
    } as unknown as AgentService);

    await controller.feedback(
      {
        answer: 'Assistant answer',
        conversationId: 'conv-1',
        rating: 'up'
      },
      'Bearer jwt-token'
    );

    expect(feedbackMock).toHaveBeenCalledWith(
      {
        answer: 'Assistant answer',
        conversationId: 'conv-1',
        rating: 'up'
      },
      'Bearer jwt-token',
      undefined
    );
  });
});

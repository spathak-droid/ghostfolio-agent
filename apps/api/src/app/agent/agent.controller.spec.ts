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

    const controller = new AgentController(agentService, {
      headers: { authorization: 'Bearer jwt-token' }
    } as never);

    await controller.chat({
      conversationId: 'conv-1',
      message: 'Analyze my portfolio allocation'
    });

    expect(chatMock).toHaveBeenCalledWith(
      {
        conversationId: 'conv-1',
        message: 'Analyze my portfolio allocation'
      },
      'Bearer jwt-token'
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

    const controller = new AgentController(agentService, {
      headers: {}
    } as never);

    await controller.widgetAsset('index.js', responseMock as never);

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
});

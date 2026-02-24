import { Injectable } from '@nestjs/common';

import { AgentChatRequest, AgentChatResponse } from './agent.types';

interface WidgetAssetProxyResponse {
  body: Buffer;
  contentType: string;
  status: number;
}

@Injectable()
export class AgentService {
  private readonly agentServiceUrl = process.env.AGENT_SERVICE_URL ?? 'http://localhost:4444';

  public async chat(
    payload: AgentChatRequest,
    authorizationHeader?: string
  ): Promise<AgentChatResponse> {
    try {
      const response = await fetch(`${this.agentServiceUrl}/chat`, {
        body: JSON.stringify(payload),
        headers: {
          ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Standalone agent error (${response.status})`);
      }

      return (await response.json()) as AgentChatResponse;
    } catch (error) {
      return {
        answer: 'I could not complete the request because a tool failed. Please retry.',
        conversation: [
          { content: payload.message, role: 'user' },
          {
            content: 'I could not complete the request because a tool failed. Please retry.',
            role: 'assistant'
          }
        ],
        errors: [
          {
            code: 'TOOL_EXECUTION_FAILED',
            message: error instanceof Error ? error.message : 'agent service unavailable',
            recoverable: true
          }
        ],
        toolCalls: [],
        verification: {
          confidence: 0.3,
          isValid: false
        }
      };
    }
  }

  public async fetchWidgetAsset(assetPath: string): Promise<WidgetAssetProxyResponse> {
    const safePath = assetPath.replace(/^\/+/, '');
    const response = await fetch(`${this.agentServiceUrl}/widget/${safePath}`);
    const contentType =
      response.headers.get('content-type') ?? 'application/octet-stream';
    const body = Buffer.from(await response.arrayBuffer());

    return {
      body,
      contentType,
      status: response.status
    };
  }
}

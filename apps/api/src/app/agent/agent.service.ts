import { Injectable } from '@nestjs/common';

import { AgentChatRequest, AgentChatResponse } from './agent.types';

interface WidgetAssetProxyResponse {
  body: Buffer;
  contentType: string;
  status: number;
}

/** Ensures URL has a scheme so fetch() does not throw "Failed to parse URL". */
function normalizeAgentServiceUrl(raw: string | undefined): string {
  const base = (raw ?? 'http://localhost:4444').trim();
  if (/^https?:\/\//i.test(base)) return base;
  return `https://${base}`;
}

@Injectable()
export class AgentService {
  private readonly agentServiceUrl = normalizeAgentServiceUrl(process.env.AGENT_SERVICE_URL);

  public async chat(
    payload: AgentChatRequest,
    authorizationHeader?: string,
    impersonationId?: string
  ): Promise<AgentChatResponse> {
    try {
      const body = {
        conversationId: payload.conversationId,
        message: payload.message
      };
      const chatUrl = `${this.agentServiceUrl}/chat`;
      // #region agent log
      fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8ff55f' },
        body: JSON.stringify({
          sessionId: '8ff55f',
          location: 'agent.service.ts:chat',
          message: 'API calling agent',
          data: {
            rawEnv: process.env.AGENT_SERVICE_URL,
            agentServiceUrl: this.agentServiceUrl,
            chatUrl
          },
          timestamp: Date.now(),
          hypothesisId: 'A'
        })
      }).catch(() => { /* ingest may be unavailable */ });
      // #endregion
      const response = await fetch(chatUrl, {
        body: JSON.stringify(body),
        headers: {
          ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
          ...(impersonationId ? { 'Impersonation-Id': impersonationId } : {}),
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Standalone agent error (${response.status})`);
      }

      return (await response.json()) as AgentChatResponse;
    } catch (error) {
      // #region agent log
      const errMsg = error instanceof Error ? error.message : 'agent service unavailable';
      const errName = error instanceof Error ? error.name : 'unknown';
      fetch('http://127.0.0.1:7808/ingest/4da1e7d4-b39c-44d9-a939-8c4e2776c91d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8ff55f' },
        body: JSON.stringify({
          sessionId: '8ff55f',
          location: 'agent.service.ts:chat catch',
          message: 'API chat fetch failed',
          data: { errName, errMsg, chatUrl: `${this.agentServiceUrl}/chat` },
          timestamp: Date.now(),
          hypothesisId: 'B'
        })
      }).catch(() => { /* ingest may be unavailable */ });
      // #endregion
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

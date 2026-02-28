import { HttpException, Injectable } from '@nestjs/common';

import { AgentChatRequest, AgentChatResponse } from './agent.types';

interface WidgetAssetProxyResponse {
  body: Buffer;
  contentType: string;
  status: number;
}

/** Ensures URL has a scheme so fetch() does not throw "Failed to parse URL". */
function normalizeAgentServiceUrl(raw: string | undefined): string {
  const base = (raw ?? 'http://localhost:4444').trim();
  if (!/^https?:\/\//i.test(base)) {
    return `https://${base}`;
  }
  // Railway internal hostnames use private network; HTTPS often fails (cert/TLS).
  // Force http for *.railway.internal so API→agent server-to-server works.
  try {
    const u = new URL(base);
    if (u.hostname.toLowerCase().endsWith('.railway.internal')) {
      u.protocol = 'http:';
      return u.toString();
    }
  } catch {
    // leave as-is if URL parse fails
  }
  return base;
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
      // Unconditional: so you see when API tries to reach the agent
      // eslint-disable-next-line no-console
      console.log('[API agent] Proxying to agent at', chatUrl);
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
      const errMsg = error instanceof Error ? error.message : 'agent service unavailable';
      // Unconditional: so you see when the agent is unreachable
      // eslint-disable-next-line no-console
      console.error('[API agent] Agent request failed:', errMsg, '- Is the agent running? npm run start:agent:run');
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

  public async acknowledge(
    payload: { message: string; conversationId?: string },
    authorizationHeader?: string,
    impersonationId?: string
  ): Promise<{ forWidget: string }> {
    try {
      const response = await fetch(`${this.agentServiceUrl}/chat/acknowledge`, {
        body: JSON.stringify(payload),
        headers: {
          ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
          ...(impersonationId ? { 'Impersonation-Id': impersonationId } : {}),
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });
      const data = (await response.json()) as { forWidget?: string };
      
      return { forWidget: data.forWidget ?? 'On it...' };
    } catch {
      return { forWidget: 'On it...' };
    }
  }

  public async clearConversation(
    conversationId: string,
    authorizationHeader?: string,
    impersonationId?: string
  ): Promise<{ ok: boolean }> {
    const clearUrl = `${this.agentServiceUrl}/chat/clear`;
    const response = await fetch(clearUrl, {
      body: JSON.stringify({ conversationId }),
      headers: {
        ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
        ...(impersonationId ? { 'Impersonation-Id': impersonationId } : {}),
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });
    const data = (await response.json()) as { ok?: boolean; error?: string; code?: string };
    if (!response.ok) {
      throw new HttpException(
        { code: data.code ?? 'AGENT_CHAT_CLEAR_FAILED', error: data.error ?? 'clear failed' },
        response.status
      );
    }
    return { ok: Boolean(data.ok) };
  }

  public async getHistory(
    authorizationHeader?: string,
    impersonationId?: string,
    limit?: number
  ): Promise<{ conversations: { id: string; title: string | null; updatedAt: string; messageCount: number }[] }> {
    const url = new URL(`${this.agentServiceUrl}/chat/history`);
    if (typeof limit === 'number' && limit > 0) {
      url.searchParams.set('limit', String(Math.min(100, limit)));
    }
    const response = await fetch(url.toString(), {
      headers: {
        ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
        ...(impersonationId ? { 'Impersonation-Id': impersonationId } : {})
      },
      method: 'GET'
    });
    const data = (await response.json()) as {
      conversations?: { id: string; title: string | null; updatedAt: string; messageCount: number }[];
    };
    if (!response.ok) {
      throw new HttpException(
        data as Record<string, unknown>,
        response.status
      );
    }
    return { conversations: data.conversations ?? [] };
  }

  public async getHistoryById(
    conversationId: string,
    authorizationHeader?: string,
    impersonationId?: string
  ): Promise<{
    id: string;
    userId: string;
    title: string | null;
    messages: { content: string; role: 'user' | 'assistant' }[];
    createdAt: string;
    updatedAt: string;
  }> {
    const response = await fetch(
      `${this.agentServiceUrl}/chat/history/${encodeURIComponent(conversationId)}`,
      {
        headers: {
          ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
          ...(impersonationId ? { 'Impersonation-Id': impersonationId } : {})
        },
        method: 'GET'
      }
    );
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new HttpException(data, response.status);
    }
    return data as {
      id: string;
      userId: string;
      title: string | null;
      messages: { content: string; role: 'user' | 'assistant' }[];
      createdAt: string;
      updatedAt: string;
    };
  }

  public async feedback(
    payload: Record<string, unknown>,
    authorizationHeader?: string,
    impersonationId?: string
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.agentServiceUrl}/feedback`, {
      body: JSON.stringify(payload),
      headers: {
        ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
        ...(impersonationId ? { 'Impersonation-Id': impersonationId } : {}),
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });
    const parsed = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new HttpException(parsed, response.status);
    }
    return parsed;
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

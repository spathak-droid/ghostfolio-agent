import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res
} from '@nestjs/common';
import type { Response } from 'express';

import { AgentChatDto } from './agent-chat.dto';
import { AgentService } from './agent.service';
import { AgentChatResponse } from './agent.types';

@Controller('agent')
export class AgentController {
  public constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  public async chat(
    @Body() body: AgentChatDto,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('impersonation-id') impersonationId?: string
  ): Promise<AgentChatResponse> {
    // Unconditional: so you always see when the widget hits the API
    // eslint-disable-next-line no-console
    console.log('[API agent] POST /chat received, message:', (body?.message ?? '').slice(0, 50));
    const hasAuthHeader = Boolean(authorizationHeader?.trim());
    const hasBodyToken = Boolean(body.accessToken?.trim());
    // #region agent log
    // eslint-disable-next-line no-console
    console.log('[agent-auth] API received:', { hasAuthHeader, hasBodyToken });
    // #endregion
    const token =
      authorizationHeader ??
      (body.accessToken?.trim() ? `Bearer ${body.accessToken.trim()}` : undefined);
    return this.agentService.chat(body, token, impersonationId);
  }

  @Post('chat/acknowledge')
  @HttpCode(200)
  public async acknowledge(
    @Body() body: { message: string; conversationId?: string },
    @Headers('authorization') authorizationHeader?: string,
    @Headers('impersonation-id') impersonationId?: string
  ): Promise<{ forWidget: string }> {
    // eslint-disable-next-line no-console
    console.log('[API agent] POST /chat/acknowledge received');
    return this.agentService.acknowledge(body, authorizationHeader, impersonationId);
  }

  @Post('chat/clear')
  @HttpCode(200)
  public async clearConversation(
    @Body() body: { conversationId: string },
    @Headers('authorization') authorizationHeader?: string,
    @Headers('impersonation-id') impersonationId?: string
  ): Promise<{ ok: boolean }> {
    return this.agentService.clearConversation(
      body.conversationId,
      authorizationHeader,
      impersonationId
    );
  }

  @Post('feedback')
  @HttpCode(200)
  public async feedback(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('impersonation-id') impersonationId?: string
  ): Promise<Record<string, unknown>> {
    return this.agentService.feedback(body, authorizationHeader, impersonationId);
  }

  @Get('chat/history')
  public async getHistory(
    @Headers('authorization') authorizationHeader?: string,
    @Headers('impersonation-id') impersonationId?: string
  ): Promise<{ conversations: { id: string; title: string | null; updatedAt: string; messageCount: number }[] }> {
    return this.agentService.getHistory(authorizationHeader, impersonationId);
  }

  @Get('chat/history/:conversationId')
  public async getHistoryById(
    @Param('conversationId') conversationId: string,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('impersonation-id') impersonationId?: string
  ): Promise<{
    id: string;
    userId: string;
    title: string | null;
    messages: { content: string; role: 'user' | 'assistant' }[];
    createdAt: string;
    updatedAt: string;
  }> {
    const token = authorizationHeader;
    return this.agentService.getHistoryById(conversationId, token, impersonationId);
  }

  @Get('widget/:asset')
  public async widgetAssetSingle(
    @Param('asset') asset: string,
    @Res() response: Response
  ): Promise<void> {
    const widgetAsset = await this.agentService.fetchWidgetAsset(asset);

    response.status(widgetAsset.status);
    response.setHeader('Content-Type', widgetAsset.contentType);
    response.send(widgetAsset.body);
  }

  @Get('widget/:folder/:asset')
  public async widgetAssetNested(
    @Param('folder') folder: string,
    @Param('asset') asset: string,
    @Res() response: Response
  ): Promise<void> {
    const widgetAsset = await this.agentService.fetchWidgetAsset(
      `${folder}/${asset}`
    );

    response.status(widgetAsset.status);
    response.setHeader('Content-Type', widgetAsset.contentType);
    response.send(widgetAsset.body);
  }
}

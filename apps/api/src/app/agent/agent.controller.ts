import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
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

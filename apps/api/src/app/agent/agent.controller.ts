import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import type { Response } from 'express';

import { AgentChatDto } from './agent-chat.dto';
import { AgentService } from './agent.service';
import { AgentChatResponse } from './agent.types';

@Controller('agent')
export class AgentController {
  public constructor(
    private readonly agentService: AgentService,
    @Inject(REQUEST) private readonly request: Request
  ) {}

  @Post('chat')
  public async chat(@Body() body: AgentChatDto): Promise<AgentChatResponse> {
    return this.agentService.chat(body, this.request.headers.authorization);
  }

  @Get('widget/*asset')
  public async widgetAsset(
    @Param('asset') asset: string,
    @Res() response: Response
  ): Promise<void> {
    const widgetAsset = await this.agentService.fetchWidgetAsset(asset);

    response.status(widgetAsset.status);
    response.setHeader('Content-Type', widgetAsset.contentType);
    response.send(widgetAsset.body);
  }
}

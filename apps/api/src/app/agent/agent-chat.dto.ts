import { IsNotEmpty, IsString } from 'class-validator';

export class AgentChatDto {
  @IsNotEmpty()
  @IsString()
  conversationId!: string;

  @IsNotEmpty()
  @IsString()
  message!: string;
}

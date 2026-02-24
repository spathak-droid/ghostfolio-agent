import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AgentChatDto {
  /** Optional: raw JWT for auth when Authorization header is not forwarded (e.g. proxy/CORS). */
  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsNotEmpty()
  @IsString()
  conversationId!: string;

  @IsNotEmpty()
  @IsString()
  message!: string;
}

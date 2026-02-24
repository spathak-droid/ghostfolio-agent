import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AgentChatDto } from './agent-chat.dto';

describe('AgentChatDto', () => {
  it('accepts valid payload', async () => {
    const dto: AgentChatDto = plainToInstance(AgentChatDto, {
      conversationId: 'conv-1',
      message: 'Analyze my portfolio allocation'
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects missing conversationId', async () => {
    const dto: AgentChatDto = plainToInstance(AgentChatDto, {
      message: 'Analyze my portfolio allocation'
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'conversationId')).toBe(
      true
    );
  });

  it('rejects empty message', async () => {
    const dto: AgentChatDto = plainToInstance(AgentChatDto, {
      conversationId: 'conv-1',
      message: ''
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'message')).toBe(true);
  });
});

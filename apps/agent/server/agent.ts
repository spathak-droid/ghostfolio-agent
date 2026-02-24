import {
  AgentChatRequest,
  AgentChatResponse,
  AgentConversationMessage,
  AgentTools
} from './types';
import { scoreConfidence } from './verification/confidence-scorer';
import { applyDomainConstraints } from './verification/domain-constraints';
import { validateOutput } from './verification/output-validator';

const memory = new Map<string, AgentConversationMessage[]>();

export function createAgent({ tools }: { tools: AgentTools }) {
  return {
    async chat({ conversationId, message, token }: AgentChatRequest): Promise<AgentChatResponse> {
      const conversation = [...(memory.get(conversationId) ?? [])];
      conversation.push({ content: message, role: 'user' });

      const errors: AgentChatResponse['errors'] = [];
      const toolCalls: AgentChatResponse['toolCalls'] = [];

      const tool = selectTool(message);

      try {
        const result = await executeTool({ message, token, tool, tools });

        toolCalls.push({
          result,
          success: true,
          toolName: tool
        });

        const baseAnswer = synthesizeAnswer(tool, result);
        const outputValidation = validateOutput(baseAnswer);
        const inputFlags = detectInputFlags(message);
        const constraints = applyDomainConstraints(baseAnswer, [
          ...outputValidation.errors,
          ...inputFlags
        ]);

        const response: AgentChatResponse = {
          answer: baseAnswer,
          conversation: [
            ...conversation,
            {
              content: baseAnswer,
              role: 'assistant'
            }
          ],
          errors,
          toolCalls,
          verification: {
            confidence: scoreConfidence({ hasErrors: false, invalid: !constraints.isValid }),
            flags: constraints.flags,
            isValid: constraints.isValid
          }
        };

        memory.set(conversationId, response.conversation);

        return response;
      } catch (error) {
        const failureAnswer =
          'I could not complete the request because a tool failed. Please retry.';

        errors.push({
          code: 'TOOL_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'unknown tool failure',
          recoverable: true
        });

        toolCalls.push({
          result: { reason: 'tool_failure' },
          success: false,
          toolName: tool
        });

        const failureResponse: AgentChatResponse = {
          answer: failureAnswer,
          conversation: [
            ...conversation,
            {
              content: failureAnswer,
              role: 'assistant'
            }
          ],
          errors,
          toolCalls,
          verification: {
            confidence: scoreConfidence({ hasErrors: true, invalid: true }),
            flags: ['tool_failure'],
            isValid: false
          }
        };

        memory.set(conversationId, failureResponse.conversation);

        return failureResponse;
      }
    }
  };
}

function detectInputFlags(message: string): string[] {
  const normalized = message.toLowerCase();
  const flags: string[] = [];

  if (
    normalized.includes('invest all your money') ||
    normalized.includes('guaranteed return')
  ) {
    flags.push('deterministic_financial_advice');
  }

  return flags;
}

async function executeTool({
  message,
  token,
  tool,
  tools
}: {
  message: string;
  token?: string;
  tool: 'market_data_lookup' | 'portfolio_analysis' | 'transaction_categorize';
  tools: AgentTools;
}) {
  if (tool === 'portfolio_analysis') {
    return tools.portfolioAnalysis({ message, token });
  }

  if (tool === 'market_data_lookup') {
    return tools.marketDataLookup({ message, token });
  }

  return tools.transactionCategorize({ message, token });
}

function selectTool(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes('portfolio') || normalized.includes('allocation')) {
    return 'portfolio_analysis' as const;
  }

  if (normalized.includes('market') || normalized.includes('price')) {
    return 'market_data_lookup' as const;
  }

  return 'transaction_categorize' as const;
}

function synthesizeAnswer(
  tool: 'market_data_lookup' | 'portfolio_analysis' | 'transaction_categorize',
  result: Record<string, unknown>
) {
  if (tool === 'portfolio_analysis') {
    return `Portfolio analysis: ${(result.summary as string) ?? 'analysis completed'}.`;
  }

  if (tool === 'market_data_lookup') {
    return 'Market data lookup completed.';
  }

  return 'Transaction categorization completed.';
}

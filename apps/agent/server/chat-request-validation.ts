/**
 * Purpose: Public validation facade for agent HTTP boundary.
 * Inputs: raw request payloads.
 * Outputs: validated params or structured 400 errors.
 * Failure modes: delegated to specialized validators under ./validation.
 */

export { CHAT_VALIDATION } from './validation/common';
export {
  validateChatBody,
  validateClearChatBody,
  type ValidatedChatBody,
  type ValidateChatBodyResult,
  type ValidateClearChatBodyResult
} from './validation/chat-validator';
export {
  validateTokenLength,
  validateImpersonationId
} from './validation/token-validator';
export { parseCreateOrderParams } from './validation/order-params-validator';
export {
  parseFeedbackBody,
  type ParsedFeedbackBody
} from './validation/feedback-validator';

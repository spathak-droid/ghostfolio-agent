/**
 * Purpose: Shared helpers for agent chat flow (affirmation detection, error message sanitization).
 * Used by agent.ts orchestration.
 */

import { sanitizeErrorMessageForClient } from '../utils';

export function sanitizeToolErrorMessage(message: string): string {
  return sanitizeErrorMessageForClient(
    message.replace(/^TOOL_EXECUTION_(FAILED|TIMEOUT):\s*/i, '').trim()
  );
}

/**
 * Detects simple affirmations like "yes", "yeah", "ok", "sure", etc.
 * Returns true if message appears to be confirming a previous question.
 */
export function isSimpleAffirmation(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  const affirmations = [
    'yes',
    'yeah',
    'yep',
    'yup',
    'ok',
    'okay',
    'sure',
    'absolutely',
    'definitely',
    'correct',
    'right',
    'true',
    'that\'s right',
    'that is right',
    'confirm',
    'confirmed',
    '✓',
    '✔'
  ];

  return affirmations.includes(trimmed) || trimmed.split(/\s+/).length <= 2;
}

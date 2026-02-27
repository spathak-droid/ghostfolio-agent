import {
  FEEDBACK_ALLOWED_KEYS,
  FEEDBACK_RATING_VALUES,
  hasControlCharacters,
  hasDisallowedFeedbackControlCharacters,
  isRecord,
  MAX_ARRAY_LENGTH,
  MAX_CONVERSATION_ID_LENGTH,
  MAX_FEEDBACK_TEXT_LENGTH,
  trimString
} from './common';

export interface ParsedFeedbackBody {
  answer: string;
  conversationId: string;
  correction?: string;
  latency?: Record<string, unknown>;
  message?: string;
  rating: (typeof FEEDBACK_RATING_VALUES)[number];
  trace?: unknown[];
}

export function parseFeedbackBody(
  value: unknown
): { ok: true; params: ParsedFeedbackBody } | { ok: false; status: 400; error: string } {
  if (!isRecord(value)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }

  const unknownKeys = Object.keys(value).filter((key) => !FEEDBACK_ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Unknown request field(s): ${unknownKeys.join(', ')}.`
    };
  }

  const conversationId = trimString(value.conversationId);
  if (!conversationId) {
    return { ok: false, status: 400, error: 'conversationId is required.' };
  }
  if (conversationId.length > MAX_CONVERSATION_ID_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `conversationId must be at most ${MAX_CONVERSATION_ID_LENGTH} characters.`
    };
  }
  if (hasControlCharacters(conversationId)) {
    return {
      ok: false,
      status: 400,
      error: 'conversationId must not contain control characters.'
    };
  }

  const answer = trimString(value.answer);
  if (!answer) {
    return { ok: false, status: 400, error: 'answer is required.' };
  }
  if (answer.length > MAX_FEEDBACK_TEXT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `answer must be at most ${MAX_FEEDBACK_TEXT_LENGTH} characters.`
    };
  }
  if (hasDisallowedFeedbackControlCharacters(answer)) {
    return {
      ok: false,
      status: 400,
      error: 'answer must not contain control characters.'
    };
  }

  const message = trimString(value.message);
  if (value.message !== undefined && message === undefined) {
    return { ok: false, status: 400, error: 'message must be a non-empty string when provided.' };
  }
  if (message && message.length > MAX_FEEDBACK_TEXT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `message must be at most ${MAX_FEEDBACK_TEXT_LENGTH} characters.`
    };
  }
  if (message && hasDisallowedFeedbackControlCharacters(message)) {
    return {
      ok: false,
      status: 400,
      error: 'message must not contain control characters.'
    };
  }

  const rawRating = trimString(value.rating);
  if (!rawRating) {
    return { ok: false, status: 400, error: 'rating is required.' };
  }
  if (!FEEDBACK_RATING_VALUES.includes(rawRating as (typeof FEEDBACK_RATING_VALUES)[number])) {
    return {
      ok: false,
      status: 400,
      error: `rating must be one of ${FEEDBACK_RATING_VALUES.join(', ')}.`
    };
  }

  const correction = trimString(value.correction);
  if (value.correction !== undefined && correction === undefined) {
    return {
      ok: false,
      status: 400,
      error: 'correction must be a non-empty string when provided.'
    };
  }
  if (correction && correction.length > MAX_FEEDBACK_TEXT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `correction must be at most ${MAX_FEEDBACK_TEXT_LENGTH} characters.`
    };
  }
  if (correction && hasDisallowedFeedbackControlCharacters(correction)) {
    return {
      ok: false,
      status: 400,
      error: 'correction must not contain control characters.'
    };
  }

  let latency: Record<string, unknown> | undefined;
  if (value.latency !== undefined) {
    if (!isRecord(value.latency)) {
      return { ok: false, status: 400, error: 'latency must be an object when provided.' };
    }
    latency = value.latency;
  }

  let trace: unknown[] | undefined;
  if (value.trace !== undefined) {
    if (!Array.isArray(value.trace)) {
      return { ok: false, status: 400, error: 'trace must be an array when provided.' };
    }
    if (value.trace.length > MAX_ARRAY_LENGTH * 10) {
      return {
        ok: false,
        status: 400,
        error: `trace must have at most ${MAX_ARRAY_LENGTH * 10} items.`
      };
    }
    trace = value.trace;
  }

  return {
    ok: true,
    params: {
      answer,
      conversationId,
      ...(correction ? { correction } : {}),
      ...(latency ? { latency } : {}),
      ...(message ? { message } : {}),
      rating: rawRating as (typeof FEEDBACK_RATING_VALUES)[number],
      ...(trace ? { trace } : {})
    }
  };
}

import { IMPERSONATION_HEADER } from '../utils/constants';
import { getAuthToken, getImpersonationId } from '../auth';
import type { AgentChatResponse } from '../types';

export function appendFeedbackControls(
  li: HTMLElement,
  response: AgentChatResponse,
  userMessage: string,
  opts: { feedbackApiUrl: string; conversationId: string }
): void {
  if (typeof response.answer !== 'string' || response.answer.trim().length === 0) {
    return;
  }

  const { feedbackApiUrl, conversationId } = opts;

  const box = document.createElement('div');
  box.className = 'agent-widget__feedback-box';

  const label = document.createElement('span');
  label.className = 'agent-widget__feedback-label';
  label.textContent = 'Was this helpful?';
  box.appendChild(label);

  const status = document.createElement('span');
  status.className = 'agent-widget__feedback-status';

  const thumbsUp = document.createElement('button');
  thumbsUp.type = 'button';
  thumbsUp.className = 'agent-widget__feedback-btn';
  thumbsUp.setAttribute('aria-label', 'Helpful response');
  thumbsUp.textContent = '👍';

  const thumbsDown = document.createElement('button');
  thumbsDown.type = 'button';
  thumbsDown.className = 'agent-widget__feedback-btn';
  thumbsDown.setAttribute('aria-label', 'Not helpful response');
  thumbsDown.textContent = '👎';

  const disableControls = () => {
    thumbsUp.disabled = true;
    thumbsDown.disabled = true;
  };

  const promptForCorrection = (): Promise<string | undefined> =>
    new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'agent-widget__details-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'agent-widget-correction-title');

      const dialog = document.createElement('div');
      dialog.className =
        'agent-widget__details-dialog agent-widget__correction-dialog';

      const header = document.createElement('div');
      header.className = 'agent-widget__details-dialog-header';
      const title = document.createElement('h3');
      title.id = 'agent-widget-correction-title';
      title.className = 'agent-widget__details-dialog-title';
      title.textContent = 'How should I improve this answer?';
      header.appendChild(title);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'agent-widget__details-dialog-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '×';
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      const body = document.createElement('div');
      body.className = 'agent-widget__details-dialog-body';
      const textarea = document.createElement('textarea');
      textarea.className = 'agent-widget__correction-textarea';
      textarea.placeholder = 'Optional: add a better answer...';
      textarea.rows = 4;
      body.appendChild(textarea);

      const actions = document.createElement('div');
      actions.className = 'agent-widget__correction-actions';
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'agent-widget__correction-btn agent-widget__correction-btn--ghost';
      skipBtn.textContent = 'Skip';
      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'agent-widget__correction-btn';
      submitBtn.textContent = 'Submit';
      actions.appendChild(skipBtn);
      actions.appendChild(submitBtn);
      body.appendChild(actions);
      dialog.appendChild(body);
      overlay.appendChild(dialog);

      const cleanup = () => {
        overlay.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onEscape);
        overlay.remove();
      };
      const finish = (value: string | undefined) => {
        cleanup();
        resolve(value);
      };
      const onBackdropClick = (e: MouseEvent) => {
        if (e.target === overlay) {
          finish(undefined);
        }
      };
      const onEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          finish(undefined);
        }
      };

      closeBtn.addEventListener('click', () => finish(undefined));
      skipBtn.addEventListener('click', () => finish(undefined));
      submitBtn.addEventListener('click', () => {
        const trimmed = textarea.value.trim();
        finish(trimmed.length > 0 ? trimmed : undefined);
      });
      overlay.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onEscape);

      document.body.appendChild(overlay);
      textarea.focus();
    });

  const submitFeedback = async (rating: 'up' | 'down') => {
    const correction =
      rating === 'down' ? await promptForCorrection() : undefined;
    try {
      const token = getAuthToken();
      const impersonationId = getImpersonationId();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (impersonationId) {
        headers[IMPERSONATION_HEADER] = impersonationId;
      }
      const result = await fetch(feedbackApiUrl, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          answer: response.answer,
          conversationId,
          latency: response.latency,
          message: userMessage,
          ...(correction && correction.trim().length > 0
            ? { correction: correction.trim() }
            : {}),
          rating,
          trace: response.trace
        })
      });
      if (result.ok) {
        status.textContent = 'Thanks for your feedback.';
        disableControls();
      } else {
        status.textContent = 'Could not submit feedback.';
      }
    } catch {
      status.textContent = 'Could not submit feedback.';
    }
  };

  thumbsUp.addEventListener('click', () => {
    void submitFeedback('up');
  });
  thumbsDown.addEventListener('click', () => {
    void submitFeedback('down');
  });

  box.appendChild(thumbsUp);
  box.appendChild(thumbsDown);
  box.appendChild(status);
  li.appendChild(box);
}

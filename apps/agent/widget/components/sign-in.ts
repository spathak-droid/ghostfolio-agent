import { setAuthToken } from '../auth';

export function createSignInCard(
  authUrl: string,
  onSuccess: () => void
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'agent-widget__sign-in-card';

  const heading = document.createElement('h3');
  heading.className = 'agent-widget__sign-in-title';
  heading.textContent = 'Sign in to Ghostfolio';
  card.appendChild(heading);

  const hint = document.createElement('p');
  hint.className = 'agent-widget__sign-in-hint';
  hint.textContent =
    'Use your Ghostfolio access token to chat. You can find it in Ghostfolio under Settings → Account.';
  card.appendChild(hint);

  const signInForm = document.createElement('form');
  signInForm.className = 'agent-widget__sign-in-form';
  signInForm.setAttribute('aria-label', 'Sign in with access token');

  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.placeholder = 'Access token';
  tokenInput.autocomplete = 'off';
  tokenInput.className = 'agent-widget__sign-in-input';
  tokenInput.name = 'accessToken';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'agent-widget__sign-in-btn';
  submitBtn.textContent = 'Sign in';

  const errorEl = document.createElement('p');
  errorEl.className = 'agent-widget__sign-in-error';
  errorEl.setAttribute('aria-live', 'polite');
  errorEl.hidden = true;

  signInForm.appendChild(tokenInput);
  signInForm.appendChild(submitBtn);
  signInForm.appendChild(errorEl);
  card.appendChild(signInForm);

  signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const accessToken = tokenInput.value.trim();
    if (!accessToken) {
      errorEl.textContent = 'Please enter your access token.';
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    errorEl.textContent = '';
    submitBtn.disabled = true;
    try {
      const res = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ accessToken })
      });
      const data = (await res.json()) as { authToken?: string };
      if (res.ok && typeof data.authToken === 'string') {
        setAuthToken(data.authToken);
        onSuccess();
      } else {
        errorEl.textContent = 'Invalid access token. Please try again.';
        errorEl.hidden = false;
        submitBtn.disabled = false;
      }
    } catch {
      errorEl.textContent = 'Sign-in request failed. Please try again.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  return card;
}

/** @jest-environment jsdom */

import { mountChatWidget } from '../../widget/chat-widget';

describe('agent widget mount', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'agent-widget-root';
    document.body.appendChild(container);
  });

  it('renders the widget shell inside the root container', () => {
    mountChatWidget(container);

    expect(container.querySelector('button.agent-widget__launcher')).toBeTruthy();
    expect(container.querySelector('.agent-widget__launcher-icon')).toBeTruthy();
    expect(container.querySelector('.agent-widget--open')).toBeNull();
  });

  it('appends a user message when the form is submitted with text', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ answer: 'Agent reply' })
    });
    global.fetch = fetchMock;

    mountChatWidget(container);

    container
      .querySelector<HTMLButtonElement>('button.agent-widget__launcher')!
      .click();

    const input = container.querySelector<HTMLInputElement>(
      '.agent-widget__form input'
    );
    expect(input).toBeTruthy();

    input!.value = 'Hello agent';
    container
      .querySelector<HTMLFormElement>('form.agent-widget__form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));

    const messageItems = container.querySelectorAll(
      '.agent-widget__message--user'
    );
    expect(messageItems.length).toBe(1);
    const userBody = messageItems[0].querySelector('.agent-widget__message-body');
    expect(userBody?.textContent).toContain('Hello agent');

    await Promise.resolve();
    await Promise.resolve();
    const assistantItems = container.querySelectorAll(
      '.agent-widget__message--assistant'
    );
    expect(assistantItems.length).toBeGreaterThanOrEqual(1);
    const replyMessage = Array.from(assistantItems).find(
      (el) => el.querySelector('.agent-widget__message-body')?.textContent === 'Agent reply'
    );
    expect(replyMessage).toBeTruthy();
  });

  it('sends bearer token in header only (not in request body)', async () => {
    window.localStorage.setItem('auth-token', 'abc.def.ghi');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ answer: 'Agent reply' })
    });
    global.fetch = fetchMock;

    mountChatWidget(container);
    container
      .querySelector<HTMLButtonElement>('button.agent-widget__launcher')!
      .click();

    const input = container.querySelector<HTMLInputElement>(
      '.agent-widget__form input'
    )!;
    input.value = 'Analyze my portfolio';
    container
      .querySelector<HTMLFormElement>('form.agent-widget__form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as {
      body: string;
      headers: Record<string, string>;
    };
    const body = JSON.parse(init.body) as Record<string, unknown>;

    expect(init.headers.Authorization).toBe('Bearer abc.def.ghi');
    expect(body).not.toHaveProperty('accessToken');
  });

  it('toggles the chatbox when the launcher is clicked', () => {
    mountChatWidget(container);

    const launcher = container.querySelector<HTMLButtonElement>(
      'button.agent-widget__launcher'
    );
    expect(launcher).toBeTruthy();
    expect(container.querySelector('.agent-widget--open')).toBeNull();

    launcher!.click();
    expect(container.querySelector('.agent-widget--open')).toBeTruthy();

    launcher!.click();
    expect(container.querySelector('.agent-widget--open')).toBeNull();
  });

  it('closes the chatbox when the close button is clicked', () => {
    mountChatWidget(container);

    const launcher = container.querySelector<HTMLButtonElement>(
      'button.agent-widget__launcher'
    );
    expect(launcher).toBeTruthy();

    launcher!.click();
    expect(container.querySelector('.agent-widget--open')).toBeTruthy();

    const closeButton = container.querySelector<HTMLButtonElement>(
      'button.agent-widget__close'
    );
    expect(closeButton).toBeTruthy();

    closeButton!.click();
    expect(container.querySelector('.agent-widget--open')).toBeNull();
  });

  it('resolves launcher icon path relative to widget script path', () => {
    const script = document.createElement('script');
    script.setAttribute('data-agent-widget-script', 'true');
    script.src = 'http://localhost:3333/api/v1/agent/widget/index.js';
    document.body.appendChild(script);

    mountChatWidget(container);

    const icon = container.querySelector<HTMLImageElement>(
      '.agent-widget__launcher-icon'
    );

    expect(icon?.src).toBe(
      'http://localhost:3333/api/v1/agent/widget/asset/ghost.svg'
    );
  });

  it('renders symbol option buttons and submits selected symbol', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            answer: 'I found multiple symbols.',
            toolCalls: [
              {
                toolName: 'create_order',
                success: true,
                result: {
                  needsClarification: true,
                  symbolOptions: [
                    { dataSource: 'YAHOO', label: 'Solana USD (SOL-USD)', symbol: 'SOL-USD' },
                    { dataSource: 'YAHOO', label: 'Solala USD (SOLALAUSD)', symbol: 'SOLALAUSD' }
                  ]
                }
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ answer: 'How many shares do you want to buy?' })
      });
    global.fetch = fetchMock;

    mountChatWidget(container);
    container
      .querySelector<HTMLButtonElement>('button.agent-widget__launcher')!
      .click();

    const input = container.querySelector<HTMLInputElement>(
      '.agent-widget__form input'
    )!;
    input.value = 'buy me solana';
    container
      .querySelector<HTMLFormElement>('form.agent-widget__form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));

    await Promise.resolve();
    await Promise.resolve();

    const optionButton = container.querySelector<HTMLButtonElement>(
      '.agent-widget__symbol-option-chip'
    );
    expect(optionButton).toBeTruthy();
    optionButton!.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      createOrderParams?: { dataSource?: string; symbol?: string };
      message: string;
    };
    expect(secondCallBody.message).toBe('SOL-USD');
    expect(secondCallBody.createOrderParams).toEqual(
      expect.objectContaining({ dataSource: 'YAHOO', symbol: 'SOL-USD' })
    );
  });
});

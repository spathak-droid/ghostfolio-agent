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

  it('appends a user message when the form is submitted with text', () => {
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
    expect(messageItems[0].textContent).toContain('Hello agent');
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
});

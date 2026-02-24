import { mountChatWidget } from './chat-widget';

const container = document.getElementById('agent-widget-root');

if (container) {
  mountChatWidget(container);
}

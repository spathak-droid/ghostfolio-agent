import { AGENT_WIDGET_ROOT_ID, AgentWidgetService } from './agent-widget.service';

describe('AgentWidgetService', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as any).info;
    container = document.createElement('div');
    container.id = AGENT_WIDGET_ROOT_ID;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not inject the widget when the script url is missing', () => {
    const service = new AgentWidgetService(document);

    service.mount({ isAuthenticated: true });

    const script = document.body.querySelector('script');
    expect(script).toBeNull();
  });

  it('does not inject the widget when user is not authenticated', () => {
    (window as any).info = {
      agentWidgetScriptUrl: 'https://agent.local/widget/index.js'
    };

    const service = new AgentWidgetService(document);

    service.mount({ isAuthenticated: false });

    const script = document.body.querySelector('script');
    expect(script).toBeNull();
  });

  it('injects the widget script once when a url is provided', () => {
    (window as any).info = {
      agentWidgetScriptUrl: 'https://agent.local/widget/index.js'
    };

    const service = new AgentWidgetService(document);

    service.mount({ isAuthenticated: true });
    service.mount({ isAuthenticated: true });

    const scripts = document.body.querySelectorAll('script');
    expect(scripts.length).toBe(1);

    const injectedScript = scripts[0];
    expect(injectedScript).toBeTruthy();
    expect(injectedScript.getAttribute('src')).toBe(
      'https://agent.local/widget/index.js'
    );
  });

  it('removes injected widget script on unmount', () => {
    (window as any).info = {
      agentWidgetScriptUrl: 'https://agent.local/widget/index.js'
    };

    const service = new AgentWidgetService(document);

    service.mount({ isAuthenticated: true });
    service.unmount();

    const script = document.body.querySelector(
      'script[data-agent-widget-script="true"]'
    );

    expect(script).toBeNull();
  });
});

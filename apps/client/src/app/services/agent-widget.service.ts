import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';

export const AGENT_WIDGET_ROOT_ID = 'agent-widget-root';

/**
 * Purpose: Safely mount the standalone agent widget inside the Ghostfolio shell.
 * Inputs: `DOCUMENT` for DOM lookups and runtime widget URL metadata.
 * Outputs: Appends the widget loader script once and delegates rendering to the agent bundle.
 * Failure modes: missing document, missing container element, or repeated mounts (should be no-op when already mounted).
 */
interface AgentWidgetMetadata {
  agentWidgetScriptUrl?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AgentWidgetService {
  private hasMounted = false;
  private readonly scriptUrl: string | null;

  public constructor(@Inject(DOCUMENT) private readonly document: Document) {
    this.scriptUrl = this.extractScriptUrlFromWindow();
  }

  public get isEnabled() {
    return Boolean(this.scriptUrl);
  }

  public mount({ isAuthenticated }: { isAuthenticated: boolean }) {
    if (!isAuthenticated || !this.scriptUrl || this.hasMounted) {
      return;
    }

    const container = this.document.getElementById(AGENT_WIDGET_ROOT_ID);

    if (!container) {
      // The container is rendered conditionally after user state updates.
      // Retry once on the next tick to avoid a mount race.
      setTimeout(() => {
        this.mount({ isAuthenticated });
      }, 0);
      return;
    }

    const script = this.document.createElement('script');
    script.type = 'module';
    script.src = this.scriptUrl;
    script.async = true;
    script.setAttribute('data-agent-widget-script', 'true');

    this.document.body.appendChild(script);
    this.hasMounted = true;
  }

  public unmount() {
    const script = this.document.querySelector(
      'script[data-agent-widget-script="true"]'
    );

    if (script) {
      script.remove();
    }

    const container = this.document.getElementById(AGENT_WIDGET_ROOT_ID);

    if (container) {
      container.innerHTML = '';
    }

    this.hasMounted = false;
  }

  private extractScriptUrlFromWindow() {
    const windowInfo = (window as unknown as { info?: AgentWidgetMetadata }).info;

    return windowInfo?.agentWidgetScriptUrl ?? null;
  }
}

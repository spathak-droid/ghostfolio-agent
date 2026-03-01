export const WIDGET_CSS_PART1 = `
    @keyframes agent-widget-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-4px); }
    }
    @keyframes agent-widget-panel-open {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    .agent-widget {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    }
    .agent-widget__launcher {
      width: 56px;
      height: 56px;
      border: none;
      border-radius: 999px;
      background: linear-gradient(145deg, #0f1320 0%, #0b0d17 100%);
      box-shadow: 0 8px 24px rgba(11, 13, 23, 0.4), 0 0 0 1px rgba(255,255,255,0.06) inset;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .agent-widget__launcher:hover {
      transform: scale(1.04);
      box-shadow: 0 12px 28px rgba(11, 13, 23, 0.45);
    }
    .agent-widget__launcher:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__launcher-icon {
      width: 32px;
      height: 32px;
      display: block;
    }
    .agent-widget__panel {
      display: none;
      width: 380px;
      max-width: 100%;
      height: 420px;
      max-height: 85vh;
      background: linear-gradient(180deg, #f8fafd 0%, #f0f4fa 100%);
      border-radius: 20px;
      box-shadow: 0 20px 56px rgba(11, 13, 23, 0.18), 0 0 0 1px rgba(11, 13, 23, 0.06);
      overflow: hidden;
      margin: 0 0 16px 16px;
      flex-direction: column;
      flex-shrink: 0;
      transform-origin: left bottom;
    }
    .agent-widget--open .agent-widget__panel {
      display: flex;
      animation: agent-widget-panel-open 0.22s ease-out forwards;
    }
    .agent-widget--open .agent-widget__launcher {
      display: none;
    }
    .agent-widget__header {
      flex-shrink: 0;
      padding: 12px 12px 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: linear-gradient(180deg, rgba(255,255,255,0.95) 0%, transparent 100%);
      border-bottom: 1px solid rgba(11, 13, 23, 0.06);
    }
    .agent-widget__header-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      display: block;
      object-fit: contain;
    }
    .agent-widget__header-content {
      min-width: 0;
      flex: 1;
    }
    .agent-widget__title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #0b0d17;
      letter-spacing: -0.01em;
    }
    .agent-widget__subtitle {
      margin: 2px 0 0;
      font-size: 12px;
      color: #5c6470;
    }
    .agent-widget__close {
      border: none;
      background: transparent;
      color: #b91c1c;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0;
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__close:hover {
      background: rgba(185, 28, 28, 0.12);
      color: #991b1b;
    }
    .agent-widget__close:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .agent-widget__new-chat {
      border: none;
      background: transparent;
      color: #5c6470;
      cursor: pointer;
      padding: 0;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__new-chat:hover {
      background: rgba(11, 13, 23, 0.06);
      color: #0b0d17;
    }
    .agent-widget__new-chat:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__new-chat-icon {
      display: block;
    }
    .agent-widget__header {
      position: relative;
    }
    .agent-widget__history-btn {
      border: none;
      background: transparent;
      color: #5c6470;
      cursor: pointer;
      padding: 0;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__history-btn:hover {
      background: rgba(11, 13, 23, 0.06);
      color: #0b0d17;
    }
    .agent-widget__history-btn:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__history-icon {
      display: block;
    }
    .agent-widget__history-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      min-width: 220px;
      max-width: 320px;
      max-height: 260px;
      overflow-y: auto;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(11, 13, 23, 0.15), 0 0 0 1px rgba(11, 13, 23, 0.06);
      z-index: 10;
      padding: 6px 0;
    }
    .agent-widget__history-dropdown[hidden] {
      display: none;
    }
    .agent-widget__history-loading,
    .agent-widget__history-empty {
      padding: 12px 14px;
      font-size: 12px;
      color: #5c6470;
      text-align: center;
    }
    .agent-widget__history-item {
      display: block;
      width: 100%;
      padding: 10px 14px;
      border: none;
      background: none;
      color: #0b0d17;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      transition: background 0.12s ease;
      line-height: 1.3;
    }
    .agent-widget__history-item:hover {
      background: rgba(61, 122, 255, 0.08);
    }
    .agent-widget__history-item:not(:last-child) {
      border-bottom: 1px solid rgba(11, 13, 23, 0.06);
    }
    .agent-widget__history-item-title {
      display: block;
    }
    .agent-widget__history-item-date {
      display: block;
      font-size: 10px;
      color: #7d8592;
      margin-top: 2px;
    }
    .agent-widget__form-wrap--hidden {
      display: none;
    }
    .agent-widget__sign-out {
      border: none;
      background: transparent;
      color: #5c6470;
      cursor: pointer;
      padding: 0;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__sign-out:hover {
      background: rgba(11, 13, 23, 0.06);
      color: #0b0d17;
    }
    .agent-widget__sign-out:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__sign-out-icon {
      display: block;
    }
    .agent-widget__sign-in-view {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
      overflow: auto;
    }
    .agent-widget__sign-in-card {
      width: 100%;
      max-width: 320px;
      margin: 0;
      padding: 24px;
      border-radius: 16px;
      background: #fff;
      border: 1px solid rgba(11, 13, 23, 0.08);
      box-shadow: 0 4px 20px rgba(11, 13, 23, 0.08);
    }
    .agent-widget__sign-in-title {
      margin: 0 0 10px 0;
      font-size: 18px;
      font-weight: 600;
      color: #0b0d17;
      text-align: center;
    }
    .agent-widget__sign-in-hint {
      margin: 0 0 16px 0;
      font-size: 13px;
      color: #5c6470;
      line-height: 1.45;
      text-align: center;
    }
    .agent-widget__sign-in-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-widget__sign-in-input {
      width: 100%;
      padding: 10px 12px;
      font-size: 14px;
      border: 1px solid rgba(11, 13, 23, 0.15);
      border-radius: 8px;
      background: #fff;
      color: #0b0d17;
      box-sizing: border-box;
    }
    .agent-widget__sign-in-input:focus {
      outline: none;
      border-color: #3d7aff;
      box-shadow: 0 0 0 2px rgba(61, 122, 255, 0.2);
    }
    .agent-widget__sign-in-btn {
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      background: linear-gradient(145deg, #3d7aff 0%, #2a5dd4 100%);
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    .agent-widget__sign-in-btn:hover:not(:disabled) {
      opacity: 0.95;
    }
    .agent-widget__sign-in-btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .agent-widget__sign-in-error {
      margin: 0;
      font-size: 13px;
      color: #c53030;
    }
    .agent-widget__messages {
      list-style: none;
      margin: 0;
      padding: 10px 12px;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .agent-widget__messages::-webkit-scrollbar {
      display: none;
    }
    .agent-widget__message {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.4;
      max-width: 88%;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .agent-widget__message-time {
      font-size: 9px;
      opacity: 0.82;
      letter-spacing: 0.02em;
    }
    .agent-widget__message--user .agent-widget__message-time {
      color: rgba(255,255,255,0.85);
    }
    .agent-widget__message--assistant .agent-widget__message-time {
      color: #5c6470;
    }
    .agent-widget__message-body {
      word-break: break-word;
      white-space: pre-line;
    }
    .agent-widget__symbol-options {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(15, 19, 32, 0.08);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .agent-widget__symbol-options-title {
      font-size: 10px;
      color: #5c6470;
    }
    .agent-widget__symbol-options-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .agent-widget__symbol-option-chip {
      border: 1px solid rgba(47, 123, 255, 0.25);
      background: rgba(47, 123, 255, 0.1);
      color: #1a5de8;
      border-radius: 10px;
      font-size: 11px;
      line-height: 1.2;
      padding: 4px 8px;
      cursor: pointer;
    }
    .agent-widget__symbol-option-chip:hover {
      background: rgba(47, 123, 255, 0.16);
    }
    .agent-widget__symbol-option-chip:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__message--welcome .agent-widget__message-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-widget__welcome-intro {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
    }
    .agent-widget__suggestions {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .agent-widget__suggestions li {
      margin: 0;
    }
    .agent-widget__suggestion-chip {
      display: inline-block;
      padding: 6px 10px;
      font-size: 11px;
      line-height: 1.3;
      color: #1a5de8;
      background: rgba(47, 123, 255, 0.1);
      border: 1px solid rgba(47, 123, 255, 0.25);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .agent-widget__suggestion-chip:hover {
      background: rgba(47, 123, 255, 0.18);
      border-color: rgba(47, 123, 255, 0.4);
      color: #0f1320;
    }
    .agent-widget__suggestion-chip:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__message--user {
      background: linear-gradient(145deg, #0f1320 0%, #0b0d17 100%);
      color: #fff;
      align-self: flex-end;
      max-width: 88%;
      border-bottom-right-radius: 6px;
    }
    .agent-widget__message--assistant {
      background: #fff;
      color: #1a1d24;
      align-self: stretch;
      width: 100%;
      max-width: 100%;
      border: 1px solid rgba(11, 13, 23, 0.08);
      border-bottom-left-radius: 6px;
    }
    .agent-widget__message--assistant.agent-widget__message--loading {
      background: #eef0f3;
      color: #5c6470;
      border-color: rgba(92, 100, 112, 0.2);
    }
    .agent-widget__message--loading {
      padding: 10px 14px;
    }
    .agent-widget__typing-dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .agent-widget__typing-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #5c6470;
      animation: agent-widget-bounce 1.2s ease-in-out infinite;
    }
    .agent-widget__typing-dot:nth-child(1) { animation-delay: 0s; }
    .agent-widget__typing-dot:nth-child(2) { animation-delay: 0.15s; }
    .agent-widget__typing-dot:nth-child(3) { animation-delay: 0.3s; }
    .agent-widget__message-body-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-width: 0;
    }
    .agent-widget__message-body-wrap .agent-widget__message-body {
      flex: 1;
      min-width: 0;
    }
    @keyframes agent-widget-spinner-loop {
      to { transform: rotate(360deg); }
    }
    .agent-widget__message-loading-spinner {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(34, 197, 94, 0.25);
      border-top-color: #22c55e;
      border-radius: 50%;
      animation: agent-widget-spinner-loop 0.7s linear infinite;
    }
    .agent-widget__message--error {
      background: #fef2f2;
      color: #991b1b;
      border-color: rgba(153, 27, 27, 0.2);
    }
    .agent-widget__form {
      flex-shrink: 0;
      width: 100%;
      padding: 10px 12px 12px;
      border-top: 1px solid rgba(11, 13, 23, 0.08);
      display: flex;
      gap: 10px;
      align-items: center;
      background: rgba(255,255,255,0.6);
    }
    .agent-widget__form-wrap {
      position: relative;
      flex-shrink: 0;
      width: 100%;
    }
    .agent-widget__form-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-width: 0;
    }
    .agent-widget__plus-trigger {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1px solid rgba(11, 13, 23, 0.12);
      background: #fff;
      color: #0b0d17;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .agent-widget__plus-trigger:hover {
      border-color: #3d7aff;
      box-shadow: 0 0 0 2px rgba(61, 122, 255, 0.2);
    }
    .agent-widget__plus-trigger:focus-visible {
      outline: none;
      border-color: #3d7aff;
      box-shadow: 0 0 0 3px rgba(61, 122, 255, 0.2);
    }
    .agent-widget__plus-trigger-icon {
      display: block;
    }
    .agent-widget__suggestions-popover {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 6px;
      display: none;
      max-height: 140px;
      overflow-y: auto;
      background: #fff;
      border: 1px solid rgba(11, 13, 23, 0.12);
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(11, 13, 23, 0.12);
      overflow-x: hidden;
      z-index: 10;
    }
`;

export const WIDGET_CSS_PART2 = `
    .agent-widget__suggestions-popover.agent-widget__suggestions-popover--open {
      display: block;
    }
    .agent-widget__suggestions-popover-item {
      display: block;
      width: 100%;
      padding: 10px 12px;
      border: none;
      background: none;
      color: #0b0d17;
      font-size: 11px;
      text-align: left;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .agent-widget__suggestions-popover-item:hover {
      background: rgba(61, 122, 255, 0.08);
    }
    .agent-widget__suggestions-popover-item:not(:last-child) {
      border-bottom: 1px solid rgba(11, 13, 23, 0.06);
    }
    .agent-widget__input {
      flex: 1;
      border: 1px solid rgba(11, 13, 23, 0.12);
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 12px;
      background: #fff;
      color: #0b0d17;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .agent-widget__input::placeholder {
      color: #7d8592;
    }
    .agent-widget__input:focus {
      outline: none;
      border-color: #3d7aff;
      box-shadow: 0 0 0 3px rgba(61, 122, 255, 0.2);
    }
    .agent-widget__input:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .agent-widget__send {
      border: none;
      border-radius: 10px;
      background: linear-gradient(145deg, #2f7bff 0%, #1a5de8 100%);
      color: #fff;
      padding: 0;
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .agent-widget__send-icon {
      display: block;
    }
    .agent-widget__send:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(47, 123, 255, 0.35);
    }
    .agent-widget__send:active:not(:disabled) {
      transform: translateY(0);
    }
    .agent-widget__send:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__send:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .agent-widget__trace-box {
      margin-top: 8px;
      padding: 6px 10px;
      border: 1px solid rgba(11, 13, 23, 0.1);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.8);
      align-self: flex-start;
    }
    .agent-widget__feedback-box {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(15, 19, 32, 0.08);
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }
    .agent-widget__feedback-label {
      font-size: 10px;
      color: #5c6470;
      margin-right: 2px;
    }
    .agent-widget__feedback-btn {
      border: 1px solid rgba(11, 13, 23, 0.12);
      background: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      padding: 4px 6px;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .agent-widget__feedback-btn:hover:not(:disabled) {
      background: #f8fafd;
      border-color: rgba(11, 13, 23, 0.2);
    }
    .agent-widget__feedback-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .agent-widget__feedback-status {
      font-size: 10px;
      color: #16a34a;
    }
    .agent-widget__correction-dialog {
      max-width: 420px;
      max-height: 70vh;
    }
    .agent-widget__correction-textarea {
      width: 100%;
      border: 1px solid rgba(11, 13, 23, 0.12);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      resize: vertical;
      box-sizing: border-box;
      font-family: inherit;
      color: #0b0d17;
      background: #fff;
    }
    .agent-widget__correction-actions {
      margin-top: 10px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .agent-widget__correction-btn {
      border: none;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      background: #1a5de8;
      color: #fff;
    }
    .agent-widget__correction-btn--ghost {
      background: #fff;
      color: #0b0d17;
      border: 1px solid rgba(11, 13, 23, 0.12);
    }
    .agent-widget__trace-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: none;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 500;
      color: #fff;
      background: #22c55e;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .agent-widget__trace-btn:hover {
      background: #16a34a;
    }
    .agent-widget__trace-btn:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: 2px;
    }
    .agent-widget__trace-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .agent-widget__trace-icon svg {
      display: block;
    }
    .agent-widget__details-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(11, 13, 23, 0.4);
      animation: agent-widget-fade-in 0.15s ease-out;
    }
    @keyframes agent-widget-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .agent-widget__details-dialog {
      width: 100%;
      max-width: 480px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 24px 48px rgba(11, 13, 23, 0.2);
      overflow: hidden;
      animation: agent-widget-dialog-in 0.2s ease-out;
    }
    @keyframes agent-widget-dialog-in {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    .agent-widget__details-dialog-header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(11, 13, 23, 0.08);
      background: #f8fafd;
    }
    .agent-widget__details-dialog-title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #0b0d17;
    }
    .agent-widget__details-dialog-close {
      border: none;
      background: transparent;
      color: #5c6470;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      padding: 0;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__details-dialog-close:hover {
      background: rgba(11, 13, 23, 0.06);
      color: #0b0d17;
    }
    .agent-widget__details-dialog-body {
      padding: 12px 16px;
      overflow-y: auto;
      max-height: 60vh;
      font-size: 11px;
    }
    .agent-widget__details-section {
      margin-bottom: 10px;
    }
    .agent-widget__details-section:last-child {
      margin-bottom: 0;
    }
    .agent-widget__trace-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-widget__trace-step {
      padding: 8px 10px;
      border: 1px solid rgba(11, 13, 23, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.6);
    }
    .agent-widget__trace-step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    .agent-widget__trace-step-index {
      font-size: 10px;
      color: #5c6470;
      font-weight: 600;
    }
    .agent-widget__trace-step-type {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .agent-widget__trace-step-type--llm {
      background: rgba(59, 130, 246, 0.15);
      color: #1d4ed8;
    }
    .agent-widget__trace-step-type--tool {
      background: rgba(34, 197, 94, 0.15);
      color: #15803d;
    }
    .agent-widget__trace-step-name {
      font-family: ui-monospace, monospace;
      font-size: 11px;
      font-weight: 500;
      color: #0b0d17;
    }
    .agent-widget__trace-step-label {
      font-size: 10px;
      color: #5c6470;
      margin-top: 4px;
      margin-bottom: 2px;
    }
    .agent-widget__details-heading {
      font-weight: 600;
      color: #0b0d17;
      margin-bottom: 4px;
    }
    .agent-widget__tool-call {
      margin-bottom: 8px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(11, 13, 23, 0.06);
    }
    .agent-widget__tool-call:last-child {
      border-bottom: none;
    }
    .agent-widget__tool-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .agent-widget__tool-name {
      font-family: ui-monospace, monospace;
      font-weight: 500;
      color: #0b0d17;
    }
    .agent-widget__tool-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 6px;
      font-weight: 500;
    }
    .agent-widget__tool-badge--success {
      background: rgba(34, 197, 94, 0.15);
      color: #15803d;
    }
    .agent-widget__tool-badge--fail {
      background: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
    }
    .agent-widget__tool-result-label {
      font-size: 10px;
      color: #5c6470;
      margin-bottom: 2px;
    }
    .agent-widget__errors-list {
      margin: 0;
      padding-left: 16px;
      color: #991b1b;
    }
    .agent-widget__error-item {
      margin-bottom: 2px;
    }
    .agent-widget__verification-line {
      font-size: 11px;
      color: #5c6470;
    }
    .agent-widget__details-dialog-body [hidden] {
      display: none !important;
    }
    .agent-widget__json-node {
      font-family: ui-monospace, monospace;
      font-size: 10px;
      line-height: 1.25;
      color: #1a1d24;
      margin: 0;
    }
    .agent-widget__json-expand {
      display: block;
      width: 100%;
      text-align: left;
      padding: 0;
      margin: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }
    .agent-widget__json-expand:hover {
      color: #1a5de8;
    }
    .agent-widget__json-key {
      color: #5c6470;
    }
    .agent-widget__json-children {
      padding-left: 12px;
      border-left: 1px solid rgba(11, 13, 23, 0.1);
      margin-top: 1px;
    }
    .agent-widget__json-entry {
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin-bottom: 2px;
      line-height: 1.25;
    }
    .agent-widget__json-entry:last-child {
      margin-bottom: 0;
    }
    .agent-widget__json-entry > .agent-widget__json-node {
      flex: 0 1 auto;
      min-width: 0;
    }
    .agent-widget__json-value {
      word-break: break-word;
    }
    .agent-widget__json-toggle-inline {
      padding: 0;
      margin-left: 4px;
      border: none;
      background: transparent;
      font-size: 10px;
      color: #1a5de8;
      cursor: pointer;
      text-decoration: underline;
    }
    .agent-widget__json-full {
      display: block;
      margin-top: 4px;
    }
    .agent-widget__holding-trend-card {
      margin-top: 10px;
      border: 1px solid rgba(26, 93, 232, 0.18);
      border-radius: 10px;
      background: linear-gradient(180deg, rgba(26, 93, 232, 0.08), rgba(26, 93, 232, 0.02));
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .agent-widget__holding-trend-title {
      font-size: 11px;
      font-weight: 700;
      color: #dbeafe;
      letter-spacing: 0.02em;
    }
    .agent-widget__holding-trend-summary,
    .agent-widget__holding-trend-sub {
      font-size: 10px;
      color: #cbd5e1;
    }
`;

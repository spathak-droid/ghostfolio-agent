import type { AgentChatResponse } from '../types';

const STRING_TRUNCATE_LEN = 200;

export function renderExpandableJson(value: unknown, depth = 0): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'agent-widget__json-node';

  if (value === null) {
    wrap.textContent = 'null';
    wrap.classList.add('agent-widget__json-value');
    return wrap;
  }
  if (typeof value === 'boolean') {
    wrap.textContent = value ? 'true' : 'false';
    wrap.classList.add('agent-widget__json-value');
    return wrap;
  }
  if (typeof value === 'number') {
    wrap.textContent = String(value);
    wrap.classList.add('agent-widget__json-value');
    return wrap;
  }
  if (typeof value === 'string') {
    wrap.classList.add('agent-widget__json-value');
    if (value.length <= STRING_TRUNCATE_LEN) {
      wrap.textContent = JSON.stringify(value);
    } else {
      const short = document.createElement('span');
      short.textContent =
        JSON.stringify(value.slice(0, STRING_TRUNCATE_LEN)) + ' …';
      const full = document.createElement('span');
      full.className = 'agent-widget__json-full';
      full.textContent = JSON.stringify(value);
      full.hidden = true;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'agent-widget__json-toggle-inline';
      toggle.textContent = ' Show more';
      toggle.addEventListener('click', () => {
        full.hidden = !full.hidden;
        toggle.textContent = full.hidden ? ' Show more' : ' Show less';
      });
      wrap.appendChild(short);
      wrap.appendChild(toggle);
      wrap.appendChild(full);
    }
    return wrap;
  }
  if (Array.isArray(value)) {
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'agent-widget__json-expand';
    header.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'agent-widget__json-key';
    label.textContent = `▶ array [${value.length}]`;
    header.appendChild(label);
    const children = document.createElement('div');
    children.className = 'agent-widget__json-children';
    children.hidden = true;
    value.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'agent-widget__json-entry';
      const idx = document.createElement('span');
      idx.className = 'agent-widget__json-key';
      idx.textContent = `${i}: `;
      row.appendChild(idx);
      row.appendChild(renderExpandableJson(item, depth + 1));
      children.appendChild(row);
    });
    header.addEventListener('click', () => {
      const expanded = children.hidden;
      children.hidden = !expanded;
      header.setAttribute('aria-expanded', String(!expanded));
      label.textContent =
        (expanded ? '▼' : '▶') + ` array [${value.length}]`;
    });
    wrap.appendChild(header);
    wrap.appendChild(children);
    return wrap;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'agent-widget__json-expand';
    header.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'agent-widget__json-key';
    label.textContent = `▶ object { ${keys.length} keys }`;
    header.appendChild(label);
    const children = document.createElement('div');
    children.className = 'agent-widget__json-children';
    children.hidden = true;
    keys.forEach((key) => {
      const row = document.createElement('div');
      row.className = 'agent-widget__json-entry';
      const keyEl = document.createElement('span');
      keyEl.className = 'agent-widget__json-key';
      keyEl.textContent = `${key}: `;
      row.appendChild(keyEl);
      row.appendChild(renderExpandableJson(obj[key], depth + 1));
      children.appendChild(row);
    });
    header.addEventListener('click', () => {
      const expanded = children.hidden;
      children.hidden = !expanded;
      header.setAttribute('aria-expanded', String(!expanded));
      label.textContent =
        (expanded ? '▼' : '▶') + ` object { ${keys.length} keys }`;
    });
    wrap.appendChild(header);
    wrap.appendChild(children);
    return wrap;
  }
  wrap.textContent = String(value);
  wrap.classList.add('agent-widget__json-value');
  return wrap;
}

export function buildDetailsContent(
  response: AgentChatResponse
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const trace = response.trace ?? [];
  const toolCalls = response.toolCalls ?? [];
  const errors = response.errors ?? [];
  const latency = response.latency;
  const verification = response.verification;

  if (latency != null) {
    const section = document.createElement('div');
    section.className = 'agent-widget__details-section';
    const heading = document.createElement('div');
    heading.className = 'agent-widget__details-heading';
    heading.textContent = 'Latency';
    section.appendChild(heading);
    const line = document.createElement('div');
    line.className = 'agent-widget__verification-line';
    line.textContent = `LLM: ${latency.llmMs}ms, Tool: ${latency.toolMs}ms, Total: ${latency.totalMs}ms`;
    section.appendChild(line);
    frag.appendChild(section);
  }

  if (trace.length > 0) {
    const section = document.createElement('div');
    section.className = 'agent-widget__details-section';
    const heading = document.createElement('div');
    heading.className = 'agent-widget__details-heading';
    heading.textContent = 'Trace';
    section.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'agent-widget__trace-list';
    trace.forEach((step, index) => {
      const item = document.createElement('div');
      item.className = 'agent-widget__trace-step';
      const header = document.createElement('div');
      header.className = 'agent-widget__trace-step-header';
      const indexEl = document.createElement('span');
      indexEl.className = 'agent-widget__trace-step-index';
      indexEl.textContent = `${index + 1}.`;
      const typeBadge = document.createElement('span');
      typeBadge.className =
        step.type === 'llm'
          ? 'agent-widget__trace-step-type agent-widget__trace-step-type--llm'
          : 'agent-widget__trace-step-type agent-widget__trace-step-type--tool';
      typeBadge.textContent = step.type === 'llm' ? 'LLM' : 'Tool';
      const nameEl = document.createElement('span');
      nameEl.className = 'agent-widget__trace-step-name';
      nameEl.textContent = step.name;
      header.appendChild(indexEl);
      header.appendChild(typeBadge);
      header.appendChild(nameEl);
      item.appendChild(header);
      if (step.input != null && Object.keys(step.input).length > 0) {
        const inputLabel = document.createElement('div');
        inputLabel.className = 'agent-widget__trace-step-label';
        inputLabel.textContent = 'Input';
        item.appendChild(inputLabel);
        item.appendChild(renderExpandableJson(step.input));
      }
      if (step.output !== undefined) {
        const outputLabel = document.createElement('div');
        outputLabel.className = 'agent-widget__trace-step-label';
        outputLabel.textContent = 'Output';
        item.appendChild(outputLabel);
        item.appendChild(renderExpandableJson(step.output));
      }
      list.appendChild(item);
    });
    section.appendChild(list);
    frag.appendChild(section);
  }

  if (toolCalls.length > 0) {
    const section = document.createElement('div');
    section.className = 'agent-widget__details-section';
    const heading = document.createElement('div');
    heading.className = 'agent-widget__details-heading';
    heading.textContent = 'Tool calls';
    section.appendChild(heading);
    toolCalls.forEach((call) => {
      const block = document.createElement('div');
      block.className = 'agent-widget__tool-call';
      const meta = document.createElement('div');
      meta.className = 'agent-widget__tool-meta';
      const name = document.createElement('span');
      name.className = 'agent-widget__tool-name';
      name.textContent = call.toolName;
      const badge = document.createElement('span');
      badge.className = call.success
        ? 'agent-widget__tool-badge agent-widget__tool-badge--success'
        : 'agent-widget__tool-badge agent-widget__tool-badge--fail';
      badge.textContent = call.success ? 'OK' : 'Fail';
      meta.appendChild(name);
      meta.appendChild(badge);
      block.appendChild(meta);
      const resultLabel = document.createElement('div');
      resultLabel.className = 'agent-widget__tool-result-label';
      resultLabel.textContent = 'Result';
      block.appendChild(resultLabel);
      block.appendChild(renderExpandableJson(call.result));
      section.appendChild(block);
    });
    frag.appendChild(section);
  }

  if (errors.length > 0) {
    const section = document.createElement('div');
    section.className = 'agent-widget__details-section';
    const heading = document.createElement('div');
    heading.className = 'agent-widget__details-heading';
    heading.textContent = 'Errors';
    section.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'agent-widget__errors-list';
    errors.forEach((err) => {
      const item = document.createElement('li');
      item.className = 'agent-widget__error-item';
      item.textContent = `${err.code}: ${err.message}`;
      list.appendChild(item);
    });
    section.appendChild(list);
    frag.appendChild(section);
  }

  if (verification != null) {
    const section = document.createElement('div');
    section.className = 'agent-widget__details-section';
    const heading = document.createElement('div');
    heading.className = 'agent-widget__details-heading';
    heading.textContent = 'Verification';
    section.appendChild(heading);
    const line = document.createElement('div');
    line.className = 'agent-widget__verification-line';
    const flags = verification.flags?.length
      ? verification.flags.join(', ')
      : '—';
    line.textContent = `Confidence: ${verification.confidence}, Valid: ${verification.isValid ? 'yes' : 'no'}, Flags: ${flags}`;
    section.appendChild(line);
    frag.appendChild(section);
  }

  const rawSection = document.createElement('div');
  rawSection.className = 'agent-widget__details-section';
  const rawHeading = document.createElement('div');
  rawHeading.className = 'agent-widget__details-heading';
  rawHeading.textContent = 'Raw response';
  rawSection.appendChild(rawHeading);
  rawSection.appendChild(renderExpandableJson(response));
  frag.appendChild(rawSection);

  return frag;
}

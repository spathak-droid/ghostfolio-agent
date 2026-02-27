import { STYLE_ELEMENT_ID } from '../utils/constants';
import { WIDGET_CSS_PART1 } from './css-1';
import { WIDGET_CSS_PART2 } from './css-2';

export function injectWidgetStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = WIDGET_CSS_PART1 + WIDGET_CSS_PART2;
  document.head.appendChild(style);
}

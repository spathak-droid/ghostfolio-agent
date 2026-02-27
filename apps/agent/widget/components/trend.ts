import {
  formatMoney,
  formatSignedMoney,
  formatSignedPercent
} from '../utils/format';
import type {
  AgentChatResponse,
  HoldingTrendPayload,
  TrendChartPoint
} from '../types';

export function getTrendPoints(
  points: TrendChartPoint[] | undefined
): TrendChartPoint[] {
  if (!Array.isArray(points)) return [];
  return points.filter((point): point is TrendChartPoint => {
    return (
      !!point &&
      typeof point === 'object' &&
      typeof point.date === 'string' &&
      typeof point.price === 'number' &&
      Number.isFinite(point.price)
    );
  });
}

export function buildTrendPath(
  points: TrendChartPoint[],
  includeAreaBase: boolean
): string {
  const width = 320;
  const height = 96;
  const xStep = points.length > 1 ? width / (points.length - 1) : width;
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min || 1;

  let path = '';
  points.forEach((point, index) => {
    const x = index * xStep;
    const y =
      height - ((point.price - min) / spread) * (height - 6) - 3;
    path +=
      index === 0
        ? `M ${x.toFixed(2)} ${y.toFixed(2)}`
        : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  if (includeAreaBase) {
    path += ` L ${width} ${height} L 0 ${height} Z`;
  }
  return path;
}

export function extractHoldingTrendPayload(
  response: AgentChatResponse
): HoldingTrendPayload | null {
  const toolCalls = response.toolCalls ?? [];
  const latest = [...toolCalls]
    .reverse()
    .find((call) => call.success && call.toolName === 'analyze_stock_trend');
  if (!latest || typeof latest.result !== 'object' || latest.result == null) {
    return null;
  }
  return latest.result as HoldingTrendPayload;
}

export function createTrendTitle(): HTMLElement {
  const heading = document.createElement('div');
  heading.className = 'agent-widget__holding-trend-title';
  heading.textContent = 'Holding trend';
  return heading;
}

export function createTrendSummary({
  perf,
  range
}: {
  perf: NonNullable<HoldingTrendPayload['performance']>;
  range: string;
}): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'agent-widget__holding-trend-summary';
  summary.textContent = `Range: ${range} | Current: ${formatMoney(perf.currentPrice)} | Period: ${formatSignedPercent(perf.periodChangePercent)}`;
  return summary;
}

export function createTrendChart(points: TrendChartPoint[]): SVGSVGElement {
  const chart = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  );
  chart.setAttribute('viewBox', '0 0 320 96');
  chart.setAttribute('preserveAspectRatio', 'none');
  chart.classList.add('agent-widget__trend-chart');

  const areaPath = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path'
  );
  areaPath.setAttribute('class', 'agent-widget__trend-area');
  areaPath.setAttribute('d', buildTrendPath(points, true));
  chart.appendChild(areaPath);

  const linePath = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path'
  );
  linePath.setAttribute('class', 'agent-widget__trend-line');
  linePath.setAttribute('d', buildTrendPath(points, false));
  chart.appendChild(linePath);
  return chart;
}

export function createTrendSinceEntry(
  perf: NonNullable<HoldingTrendPayload['performance']>
): HTMLElement {
  const sub = document.createElement('div');
  sub.className = 'agent-widget__holding-trend-sub';
  sub.textContent = `Since entry: ${formatSignedPercent(perf.sinceEntryChangePercent)} (${formatSignedMoney(perf.sinceEntryChange)})`;
  return sub;
}

export function createTrendCard({
  points,
  trendPayload
}: {
  points: TrendChartPoint[];
  trendPayload: HoldingTrendPayload;
}): HTMLElement {
  const card = document.createElement('div');
  card.className = 'agent-widget__holding-trend-card';
  const perf = trendPayload.performance ?? {};
  card.appendChild(createTrendTitle());
  card.appendChild(
    createTrendSummary({
      perf,
      range: trendPayload.chart?.range ?? 'custom'
    })
  );
  card.appendChild(createTrendChart(points));
  card.appendChild(createTrendSinceEntry(perf));
  return card;
}

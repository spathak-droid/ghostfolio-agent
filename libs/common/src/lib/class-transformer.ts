import { Big } from 'big.js';

function toNumberOrZero(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function transformToMapOfBig({
  value
}: {
  value: { [key: string]: string };
}): {
  [key: string]: Big;
} {
  const mapOfBig: { [key: string]: Big } = {};

  if (value && typeof value === 'object') {
    for (const key in value) {
      mapOfBig[key] = new Big(toNumberOrZero(value[key]));
    }
  }

  return mapOfBig;
}

export function transformToBig({ value }: { value: unknown }): Big {
  const n = toNumberOrZero(value);
  return new Big(n);
}

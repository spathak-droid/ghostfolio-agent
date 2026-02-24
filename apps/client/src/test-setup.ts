import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

if (!(globalThis as { $localize?: (parts: TemplateStringsArray) => string }).$localize) {
  (globalThis as { $localize: (parts: TemplateStringsArray) => string }).$localize = (
    parts: TemplateStringsArray
  ) => parts[0] ?? '';
}

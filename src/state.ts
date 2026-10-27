import { api } from './api';
import type { AppConfig } from './types';

let configPromise: Promise<AppConfig> | null = null;

/** Classes, topics and limits (public, cached for the page lifetime). */
export function getConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = api<AppConfig>('config.get').catch((err) => {
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
}

export function invalidateConfig() {
  configPromise = null;
}

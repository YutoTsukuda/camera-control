#!/usr/bin/env node
/** エントリポイント。 */
import { createApp } from './server/app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

await app.listen();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

import { createApp } from './app.mjs';
import { readConfig } from './config.mjs';
const config = readConfig();
const server = createApp(config);
server.on('error', error => { console.error(`Cannot start launcher (${error.code || error.message}). Check port access and HOST/PORT configuration.`); process.exitCode = 1; });
server.listen(config.port, config.host, () => console.log(`Miners launcher: ${config.origin}\nEngine/server integration: ${config.gameEnabled ? 'enabled; verify readiness in /api/health' : 'not enabled'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

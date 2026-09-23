import { resolve } from 'node:path';
import { createPortfolioServer } from '../server/index.mjs';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid port between 1 and 65535.');
const host = process.env.HOST || '127.0.0.1';
const server = await createPortfolioServer({
  rootDir: resolve(args.includes('--dist') ? 'dist' : '.'),
  dataDir: resolve(process.env.CMS_DATA_DIR || '.cms-data'),
  origin: process.env.SITE_ORIGIN,
});
server.listen(port, host, () => console.log(`Portfolio ready at http://${host}:${port}\nConsole: http://${host}:${port}/admin`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));

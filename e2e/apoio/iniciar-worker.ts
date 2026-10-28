import { spawn, spawnSync } from 'node:child_process';
import {
  HMAC_2FA_SEGREDO,
  PORTA_WORKER,
  RAIZ,
  TOKEN_WEBHOOK,
  URL_APP,
  URL_BANCO_APP,
  URL_COLETOR,
} from './config.ts';
import { prepararBanco } from './preparar-banco.ts';

// OPS-05: comando do webServer do Playwright. Prepara o banco, gera o front e sobe o Worker local
// (wrangler dev) ligado ao banco do e2e e ao coletor de e-mail. As variáveis vão pelo ambiente do
// processo (CLOUDFLARE_INCLUDE_PROCESS_ENV), sem arquivo e sem --var, para a chave do Asaas não
// aparecer em linha de comando nem em log.
const windows = process.platform === 'win32';

await prepararBanco();
const build = spawnSync('pnpm', ['build:web'], { cwd: RAIZ, stdio: 'inherit', shell: windows });
if (build.status !== 0) throw new Error('pnpm build:web falhou');

const filho = spawn(
  'pnpm',
  [
    '--filter',
    '@es/api',
    'exec',
    'wrangler',
    'dev',
    '--config',
    '../../wrangler.jsonc',
    '--port',
    String(PORTA_WORKER),
  ],
  {
    cwd: RAIZ,
    stdio: 'inherit',
    shell: windows,
    env: {
      ...process.env,
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: URL_BANCO_APP,
      WRANGLER_SEND_METRICS: 'false',
      URL_PUBLICA: URL_APP,
      HMAC_2FA_SEGREDO,
      ASAAS_WEBHOOK_TOKEN: TOKEN_WEBHOOK,
      E2E_EMAIL_CAPTURA_URL: `${URL_COLETOR}/emails`,
      ASAAS_BASE_URL: 'https://api-sandbox.asaas.com/v3',
    },
  },
);
function encerrar(): void {
  if (windows && filho.pid) spawnSync('taskkill', ['/pid', String(filho.pid), '/T', '/F']);
  else filho.kill('SIGTERM');
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
process.on('exit', encerrar);
filho.on('exit', (codigo) => process.exit(codigo ?? 0));

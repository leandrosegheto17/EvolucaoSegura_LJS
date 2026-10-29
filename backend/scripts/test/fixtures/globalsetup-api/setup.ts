import { prepararBancoEm } from '../../../../api/test/preparar-banco.ts';

const urlServidor =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5433/evolucao_segura';

export default async function setup(): Promise<() => Promise<void>> {
  const nome = `es_api_g_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  return prepararBancoEm(urlServidor, nome);
}

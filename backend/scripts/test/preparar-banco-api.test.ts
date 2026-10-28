import { describe, expect, it } from 'vitest';
import { prepararBancoEm } from '../../api/test/preparar-banco.ts';
import { HostRecusado } from '../src/seguranca/trava-host.ts';

// Padrão Neon, item 4: o globalSetup dos testes da API troca a senha da role do app e por isso só
// aceita o Postgres local. A recusa acontece antes de qualquer conexão (URL fictícia, sem senha).

describe('preparar-banco da API: trava de host', () => {
  it.each([
    ['o Neon', 'postgresql://u@ep-exemplo-123456.sa-east-1.aws.neon.tech/banco?sslmode=require'],
    ['outro host remoto', 'postgresql://u@db.exemplo.com:5432/banco'],
  ])('recusa %s', async (_caso, url) => {
    await expect(prepararBancoEm(url)).rejects.toThrow(HostRecusado);
  });
});

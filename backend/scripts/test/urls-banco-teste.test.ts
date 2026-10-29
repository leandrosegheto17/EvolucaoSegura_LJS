import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { URL_LOCAL_PADRAO } from '../src/migrar.ts';
import { urlServidorDe } from '../../api/vitest.urls.ts';
import { urlsBancoE2e } from '../../../e2e/apoio/config.ts';

// T207 / OPS-05: os padrões de banco dos testes da API e do e2e usam 127.0.0.1, não localhost (no
// Windows o localhost resolve primeiro para IPv6 e a conexão ao Postgres do docker-compose expira
// sem mensagem), e a porta vem de PG_PORTA (padrão 5433, a do docker-compose; o CI usa 5432).

describe('URL do servidor dos testes da API (backend/api/vitest.urls.ts)', () => {
  it('sem variável: 127.0.0.1 na porta 5433 do docker-compose', () => {
    expect(urlServidorDe({})).toBe('postgres://postgres:postgres@127.0.0.1:5433/evolucao_segura');
  });

  it('PG_PORTA troca só a porta', () => {
    expect(urlServidorDe({ PG_PORTA: '5432' })).toBe(
      'postgres://postgres:postgres@127.0.0.1:5432/evolucao_segura',
    );
  });

  it('DATABASE_URL vale inteira e tem precedência sobre PG_PORTA', () => {
    const url = 'postgres://u:s@db.interno:6543/outro';
    expect(urlServidorDe({ DATABASE_URL: url, PG_PORTA: '5432' })).toBe(url);
  });

  it('PG_PORTA vazia cai no padrão 5433', () => {
    expect(urlServidorDe({ PG_PORTA: '' })).toContain('@127.0.0.1:5433/');
  });

  it.each(['abc', '54 32', '-1', '70000', '0'])('PG_PORTA inválida (%j) é recusada', (porta) => {
    expect(() => urlServidorDe({ PG_PORTA: porta })).toThrow(/PG_PORTA/);
  });
});

describe('URLs do banco do e2e (e2e/apoio/config.ts)', () => {
  it('sem variável: 127.0.0.1:5433, banco do e2e, admin e role da aplicação', () => {
    expect(urlsBancoE2e({})).toEqual({
      admin: 'postgres://postgres:postgres@127.0.0.1:5433/evolucao_segura_e2e',
      app: 'postgres://evolucao_app:evolucao_app@127.0.0.1:5433/evolucao_segura_e2e',
    });
  });

  it('PG_PORTA troca a porta das duas URLs', () => {
    const { admin, app } = urlsBancoE2e({ PG_PORTA: '5432' });
    expect(admin).toBe('postgres://postgres:postgres@127.0.0.1:5432/evolucao_segura_e2e');
    expect(app).toBe('postgres://evolucao_app:evolucao_app@127.0.0.1:5432/evolucao_segura_e2e');
  });

  it('PG_PORTA vazia cai no padrão 5433', () => {
    expect(urlsBancoE2e({ PG_PORTA: '' }).admin).toContain('@127.0.0.1:5433/');
  });

  it.each(['abc', '5432x', '70000'])('PG_PORTA inválida (%j) é recusada', (porta) => {
    expect(() => urlsBancoE2e({ PG_PORTA: porta })).toThrow(/PG_PORTA/);
  });
});

describe('nenhum padrão de banco local usa localhost (T207)', () => {
  // Padrões são as URLs que valem quando DATABASE_URL não está definida (testes, globalSetup,
  // `pnpm migrar` local). URLs de exemplo usadas como entrada de teste (ex.: trava de host) não
  // usam o usuário postgres:postgres e ficam de fora.
  const raiz = fileURLToPath(new URL('../../../', import.meta.url));
  // Montado em partes para este arquivo não casar consigo mesmo.
  const PADRAO = new RegExp(['postgres:postgres', 'localhost'].join('@'));
  function arquivos(pasta: string): string[] {
    return readdirSync(join(raiz, pasta), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.includes('node_modules'))
      .map((f) => join(pasta, f));
  }

  it('backend/api, backend/scripts e e2e não apontam o usuário postgres para localhost', () => {
    const achados = ['backend/api', 'backend/scripts', 'e2e']
      .flatMap(arquivos)
      .filter((f) => PADRAO.test(readFileSync(join(raiz, f), 'utf8')));
    expect(achados).toEqual([]);
  });

  it('o padrão do `pnpm migrar` local é 127.0.0.1:5433', () => {
    expect(URL_LOCAL_PADRAO).toBe('postgres://postgres:postgres@127.0.0.1:5433/evolucao_segura');
  });
});

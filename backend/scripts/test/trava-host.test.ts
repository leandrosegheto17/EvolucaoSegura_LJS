import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { migrar, resolverConexao, URL_LOCAL_PADRAO } from '../src/migrar.ts';
import { UrlNeonRecusada } from '../src/neon/url-neon.ts';
import {
  exigirHostLocal,
  exigirHostPermitido,
  hostDaUrl,
  hostELocal,
  HostRecusado,
} from '../src/seguranca/trava-host.ts';

// Padrão Neon, item 4: nenhum script escreve num banco remoto sem decisão explícita. Local passa;
// remoto exige --alvo producao|dev e CI=true ou o host digitado. URLs fictícias, sem senha: os
// casos recusados lançam antes de qualquer conexão.

const HOST = 'ep-exemplo-123456.sa-east-1.aws.neon.tech';
const remota = `postgresql://u@${HOST}/evolucao?sslmode=require`;
const local = 'postgresql://postgres@localhost:5433/banco';

describe('hostELocal e hostDaUrl', () => {
  it.each(['localhost', '127.0.0.1', '127.5.6.7', '::1'])('%s é local', (host) => {
    expect(hostELocal(host)).toBe(true);
  });

  it.each([HOST, '10.0.0.1', '128.0.0.1', '127.0.0.256', 'localhost.exemplo.com', 'db'])(
    '%s não é local',
    (host) => {
      expect(hostELocal(host)).toBe(false);
    },
  );

  it.each([
    ['ausente', undefined],
    ['inválida', 'nada'],
    ['sem host', 'postgresql:///banco'],
    ['com host na consulta', `${local}?host=${HOST}`],
    ['com vários hosts', `postgresql://u@a.neon.tech,b.neon.tech/evolucao`],
  ])('recusa URL %s', (_caso, url) => {
    expect(() => hostDaUrl(url)).toThrow(HostRecusado);
  });
});

describe('exigirHostPermitido', () => {
  it('host local passa sem alvo', async () => {
    await expect(exigirHostPermitido({ url: local })).resolves.toBe('localhost');
  });

  it('host remoto sem alvo é recusado, mesmo com CI=true', async () => {
    await expect(exigirHostPermitido({ url: remota, ci: 'true' })).rejects.toThrow(/--alvo/);
  });

  it('host remoto com alvo desconhecido é recusado', async () => {
    await expect(exigirHostPermitido({ url: remota, alvo: 'teste', ci: 'true' })).rejects.toThrow(
      HostRecusado,
    );
  });

  it.each(['producao', 'dev'])('host remoto com --alvo %s e CI=true passa', async (alvo) => {
    await expect(exigirHostPermitido({ url: remota, alvo, ci: 'true' })).resolves.toBe(HOST);
  });

  it('host remoto com alvo, fora do CI e sem confirmação é recusado', async () => {
    await expect(exigirHostPermitido({ url: remota, alvo: 'producao' })).rejects.toThrow(
      /confirmação/,
    );
  });

  it('CI diferente de "true" não dispensa a confirmação', async () => {
    await expect(exigirHostPermitido({ url: remota, alvo: 'producao', ci: '1' })).rejects.toThrow(
      HostRecusado,
    );
  });

  it('confirmação com o host exato passa; com outro texto é recusada', async () => {
    await expect(
      exigirHostPermitido({ url: remota, alvo: 'producao', confirmar: () => HOST }),
    ).resolves.toBe(HOST);
    await expect(
      exigirHostPermitido({ url: remota, alvo: 'producao', confirmar: () => 'sim' }),
    ).rejects.toThrow(HostRecusado);
  });

  it('não pergunta nada quando o host é local', async () => {
    const confirmar = vi.fn(() => '');
    await exigirHostPermitido({ url: local, confirmar });
    expect(confirmar).not.toHaveBeenCalled();
  });
});

describe('exigirHostLocal', () => {
  it('aceita só host local', () => {
    expect(exigirHostLocal(local)).toBe('localhost');
    expect(() => exigirHostLocal(remota)).toThrow(HostRecusado);
  });
});

describe('pnpm migrar: escolha da conexão', () => {
  it('sem --alvo usa DATABASE_URL e, sem ela, o Postgres local', () => {
    expect(resolverConexao([], { DATABASE_URL: local })).toEqual({ urlBanco: local });
    expect(resolverConexao([], {})).toEqual({ urlBanco: URL_LOCAL_PADRAO });
  });

  it('--alvo producao lê NEON_URL_MIGRACAO e ignora DATABASE_URL', () => {
    const ambiente = { DATABASE_URL: local, NEON_URL_MIGRACAO: remota };
    expect(resolverConexao(['--alvo', 'producao'], ambiente)).toEqual({
      urlBanco: remota,
      alvo: 'producao',
    });
    expect(resolverConexao(['--alvo=producao'], ambiente).alvo).toBe('producao');
  });

  it('--alvo dev lê NEON_URL_DEV', () => {
    const ambiente = { NEON_URL_MIGRACAO: remota, NEON_URL_DEV: remota };
    expect(resolverConexao(['--alvo', 'dev'], ambiente)).toEqual({ urlBanco: remota, alvo: 'dev' });
    expect(() => resolverConexao(['--alvo', 'dev'], { NEON_URL_MIGRACAO: remota })).toThrow(
      /NEON_URL_DEV/,
    );
  });

  it('--alvo vazio ou desconhecido é recusado', () => {
    expect(() => resolverConexao(['--alvo'], { NEON_URL_MIGRACAO: remota })).toThrow(HostRecusado);
    expect(() => resolverConexao(['--alvo', 'teste'], {})).toThrow(HostRecusado);
  });

  it('--alvo com URL que não passa na validação do Neon é recusado', () => {
    const pooler = remota.replace('ep-exemplo-123456', 'ep-exemplo-123456-pooler');
    expect(() => resolverConexao(['--alvo', 'producao'], { NEON_URL_MIGRACAO: pooler })).toThrow(
      UrlNeonRecusada,
    );
    expect(() => resolverConexao(['--alvo', 'producao'], { NEON_URL_MIGRACAO: local })).toThrow(
      UrlNeonRecusada,
    );
  });
});

describe('migrar(): trava antes de conectar', () => {
  const pasta = resolve(import.meta.dirname, '../migrations');

  it('recusa host remoto sem alvo', async () => {
    await expect(migrar({ urlBanco: remota, pasta, ci: 'true' })).rejects.toThrow(HostRecusado);
  });

  it('recusa host remoto com alvo, fora do CI e sem confirmação', async () => {
    await expect(migrar({ urlBanco: remota, pasta, alvo: 'producao' })).rejects.toThrow(
      HostRecusado,
    );
  });
});

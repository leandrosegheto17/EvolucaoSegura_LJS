import type { EventoAuditoria } from '@es/contrato/auditoria';
import { env } from 'cloudflare:workers';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { comTransacao } from '../../src/db.ts';
import {
  registrarAuditoria,
  resumirUserAgent,
  truncarIp,
} from '../../src/repositorios/auditoria.ts';

// T33 / AUD-01, AUD-02: o evento é gravado na mesma transação da operação (falha da auditoria
// desfaz a operação), com IP truncado (/24 IPv4, /48 IPv6), user-agent resumido e sem conteúdo
// clínico. Casos de truncamento e resumo trazidos do teste do legado (audit.spec.ts).

const admin = (env as unknown as { HYPERDRIVE_ADMIN: Hyperdrive }).HYPERDRIVE_ADMIN;

async function linhasDoAlvo(alvoId: string): Promise<Record<string, unknown>[]> {
  const cliente = new pg.Client({ connectionString: admin.connectionString });
  cliente.on('error', () => {});
  await cliente.connect();
  try {
    return (await cliente.query('select * from audit_log where alvo_id = $1', [alvoId])).rows;
  } finally {
    await cliente.end();
  }
}

const novoId = (): string => crypto.randomUUID();

const evento = (usuarioId: string, alvoId: string): EventoAuditoria => ({
  usuarioId,
  ator: usuarioId,
  acao: 'evolucao.retificada',
  alvoTipo: 'evolucao',
  alvoId,
});

describe('truncarIp', () => {
  it('trunca IPv4 em /24', () => {
    expect(truncarIp('203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncarIp('10.1.2.3')).toBe('10.1.2.0/24');
  });

  it('trunca IPv6 em /48', () => {
    expect(truncarIp('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48');
    expect(truncarIp('2001:0db8:abcd:1234:5678:9abc:def0:1234')).toBe('2001:db8:abcd::/48');
  });

  it('trunca IPv6 abreviado nos primeiros 48 bits reais', () => {
    expect(truncarIp('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(truncarIp('::1')).toBe('0:0:0::/48');
  });

  it('devolve null para entrada ausente ou não reconhecida', () => {
    expect(truncarIp(null)).toBeNull();
    expect(truncarIp(undefined)).toBeNull();
    expect(truncarIp('')).toBeNull();
    expect(truncarIp('lixo')).toBeNull();
    expect(truncarIp('300.1.2.3')).toBeNull();
  });
});

describe('resumirUserAgent', () => {
  it('guarda só produto e versão principal, até 80 caracteres', () => {
    expect(resumirUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0')).toBe('Mozilla/5');
    expect(resumirUserAgent('curl/8.1 (extra)')).toBe('curl/8');
    expect(resumirUserAgent(`${'a'.repeat(100)}/1`)).toHaveLength(80);
  });

  it('marca user-agent sem produto como desconhecido e ausente como null', () => {
    expect(resumirUserAgent('???')).toBe('desconhecido');
    expect(resumirUserAgent('')).toBeNull();
    expect(resumirUserAgent(null)).toBeNull();
  });
});

describe('registrarAuditoria', () => {
  it('grava o evento com IP truncado, user-agent resumido e só nomes de campo', async () => {
    const usuario = novoId();
    const alvo = novoId();

    await comTransacao(env, usuario, (trx) =>
      registrarAuditoria(trx, {
        ...evento(usuario, alvo),
        camposAlterados: ['texto', 'texto', 'valor_centavos'],
        ip: '203.0.113.77',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',
      }),
    );

    const [linha] = await linhasDoAlvo(alvo);
    expect(linha).toMatchObject({
      usuario_id: usuario,
      ator: usuario,
      acao: 'evolucao.retificada',
      alvo_tipo: 'evolucao',
      alvo_id: alvo,
      campos_alterados: ['texto', 'valor_centavos'],
      origem_ip: '203.0.113.0/24',
      origem_ua: 'Mozilla/5',
    });
  });

  it('grava IPv6 truncado em /48', async () => {
    const usuario = novoId();
    const alvo = novoId();

    await comTransacao(env, usuario, (trx) =>
      registrarAuditoria(trx, { ...evento(usuario, alvo), ip: '2001:db8:abcd:1234::1' }),
    );

    expect((await linhasDoAlvo(alvo))[0]).toMatchObject({ origem_ip: '2001:db8:abcd::/48' });
  });

  it('não grava conteúdo clínico: chave extra é recusada e nada fica gravado', async () => {
    const usuario = novoId();
    const alvo = novoId();
    const comTexto = { ...evento(usuario, alvo), texto: 'paciente relata ansiedade' };

    await expect(
      comTransacao(env, usuario, (trx) =>
        registrarAuditoria(trx, comTexto as unknown as EventoAuditoria),
      ),
    ).rejects.toThrow();

    expect(await linhasDoAlvo(alvo)).toEqual([]);
  });

  it('não grava valor em vez de nome de campo', async () => {
    const usuario = novoId();
    const alvo = novoId();

    await expect(
      comTransacao(env, usuario, (trx) =>
        registrarAuditoria(trx, {
          ...evento(usuario, alvo),
          camposAlterados: ['Paciente relata dor'],
        }),
      ),
    ).rejects.toThrow();

    expect(await linhasDoAlvo(alvo)).toEqual([]);
  });

  it('falha de validação da auditoria desfaz a operação da mesma transação', async () => {
    const usuario = novoId();
    const alvoDaOperacao = novoId();

    await expect(
      comTransacao(env, usuario, async (trx) => {
        // Operação da requisição (aqui, uma gravação válida) seguida de auditoria inválida.
        await registrarAuditoria(trx, evento(usuario, alvoDaOperacao));
        await registrarAuditoria(trx, {
          ...evento(usuario, novoId()),
          acao: 'evolucao.texto_livre' as EventoAuditoria['acao'],
        });
      }),
    ).rejects.toThrow();

    expect(await linhasDoAlvo(alvoDaOperacao)).toEqual([]);
  });

  it('falha do banco ao gravar a auditoria desfaz a operação da mesma transação', async () => {
    const usuario = novoId();
    const outro = novoId();
    const alvoDaOperacao = novoId();

    await expect(
      comTransacao(env, usuario, async (trx) => {
        await registrarAuditoria(trx, evento(usuario, alvoDaOperacao));
        // Evento em nome de outro profissional: o RLS recusa a gravação no banco.
        await registrarAuditoria(trx, evento(outro, novoId()));
      }),
    ).rejects.toThrow();

    expect(await linhasDoAlvo(alvoDaOperacao)).toEqual([]);
  });
});

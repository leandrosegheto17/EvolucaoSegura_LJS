import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { UrlNeonRecusada, validarUrlNeon } from '../src/neon/url-neon.ts';
import { validarVariavel } from '../src/neon/validar-url.ts';

// Padrão Neon, item 4: uma função única valida toda URL que toca o Neon. Recusa host -pooler,
// localhost, conexão sem TLS exigido e host fora de .neon.tech. As URLs daqui são fictícias e sem
// senha; nada conecta.

const HOST = 'ep-exemplo-123456.sa-east-1.aws.neon.tech';
const valida = `postgresql://evolucao_app@${HOST}/banco?sslmode=require`;

const recusa = (url: string | undefined) => () => validarUrlNeon(url, 'NEON_URL_TESTE');

describe('validarUrlNeon', () => {
  it('aceita a conexão direta do Neon com sslmode=require e devolve o host', () => {
    expect(validarUrlNeon(valida)).toEqual({ host: HOST });
  });

  it.each(['verify-ca', 'verify-full'])('aceita sslmode=%s', (modo) => {
    expect(validarUrlNeon(valida.replace('require', modo)).host).toBe(HOST);
  });

  it('aceita postgres:// e outros parâmetros junto do sslmode (formato do console do Neon)', () => {
    const url = `postgres://u@${HOST}/banco?sslmode=require&channel_binding=require`;
    expect(validarUrlNeon(url).host).toBe(HOST);
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['inválida', 'isto não é url'],
    ['de outro protocolo', `https://${HOST}/banco?sslmode=require`],
  ])('recusa URL %s', (_caso, url) => {
    expect(recusa(url)).toThrow(UrlNeonRecusada);
  });

  it.each([
    ['ep-exemplo-123456-pooler.sa-east-1.aws.neon.tech'],
    ['EP-EXEMPLO-123456-POOLER.sa-east-1.aws.neon.tech'],
    ['ep-exemplo-123456.sa-east-1-pooler.aws.neon.tech'],
  ])('recusa o host do pooler (%s)', (host) => {
    expect(recusa(`postgresql://u@${host}/banco?sslmode=require`)).toThrow(/pooler/);
  });

  it.each([['localhost'], ['127.0.0.1'], ['[::1]']])('recusa host local (%s)', (host) => {
    expect(recusa(`postgresql://u@${host}:5432/banco?sslmode=require`)).toThrow(/local/);
  });

  it.each([
    ['fora do Neon', 'db.exemplo.com'],
    ['que só termina parecido', 'ep-x.sa-east-1.aws.falsoneon.tech'],
    ['que é o próprio domínio', 'neon.tech'],
    ['com o domínio no meio', 'neon.tech.exemplo.com'],
  ])('recusa host %s', (_caso, host) => {
    expect(recusa(`postgresql://u@${host}/banco?sslmode=require`)).toThrow(/não é do Neon/);
  });

  it.each([
    ['sem sslmode', `postgresql://u@${HOST}/banco`],
    ['com sslmode=disable', `postgresql://u@${HOST}/banco?sslmode=disable`],
    ['com sslmode=prefer', `postgresql://u@${HOST}/banco?sslmode=prefer`],
    ['com sslmode=allow', `postgresql://u@${HOST}/banco?sslmode=allow`],
    ['com dois sslmode', `postgresql://u@${HOST}/banco?sslmode=require&sslmode=disable`],
  ])('recusa conexão sem TLS exigido (%s)', (_caso, url) => {
    expect(recusa(url)).toThrow(/TLS/);
  });

  it.each([
    ['host na consulta', `postgresql://u@${HOST}/banco?sslmode=require&host=localhost`],
    ['hostaddr na consulta', `postgresql://u@${HOST}/banco?sslmode=require&hostaddr=127.0.0.1`],
  ])('recusa %s (sobrescreve o host no libpq)', (_caso, url) => {
    expect(recusa(url)).toThrow(UrlNeonRecusada);
  });

  it('a mensagem cita a variável e o host, nunca a senha', () => {
    const comSenha = `postgresql://u:senha-secreta-123@${HOST.replace('ep-', 'ep-x-pooler-')}/banco`;
    let mensagem = '';
    try {
      validarUrlNeon(comSenha, 'NEON_URL_TESTE');
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toContain('NEON_URL_TESTE');
    expect(mensagem).not.toContain('senha-secreta-123');
  });
});

describe('validar-url (linha de comando dos workflows)', () => {
  const raizDoPacote = resolve(import.meta.dirname, '..');
  const executar = promisify(execFile);

  it('validarVariavel aceita só nomes NEON_URL_*', () => {
    expect(validarVariavel('NEON_URL_BACKUP', { NEON_URL_BACKUP: valida })).toContain(
      'NEON_URL_BACKUP',
    );
    expect(() => validarVariavel('DATABASE_URL', { DATABASE_URL: valida })).toThrow(
      UrlNeonRecusada,
    );
    expect(() => validarVariavel(undefined, {})).toThrow(UrlNeonRecusada);
  });

  it('sai com 0 para uma URL válida, sem imprimir a URL', async () => {
    const { stdout } = await executar(
      process.execPath,
      ['src/neon/validar-url.ts', 'NEON_URL_BACKUP'],
      { cwd: raizDoPacote, env: { ...process.env, NEON_URL_BACKUP: valida } },
    );
    expect(stdout).toContain('NEON_URL_BACKUP');
    expect(stdout).not.toContain(HOST);
  });

  it('sai com 1 para uma URL do pooler', async () => {
    const pooler = valida.replace('ep-exemplo-123456', 'ep-exemplo-123456-pooler');
    await expect(
      executar(process.execPath, ['src/neon/validar-url.ts', 'NEON_URL_BACKUP'], {
        cwd: raizDoPacote,
        env: { ...process.env, NEON_URL_BACKUP: pooler },
      }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('pooler') });
  });
});

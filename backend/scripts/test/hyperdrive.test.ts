import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { comandoCriarHyperdrive, comandoValidado, VARIAVEL_CONEXAO } from '../src/hyperdrive.ts';
import { UrlNeonRecusada } from '../src/neon/url-neon.ts';

// T34 / OPS-13: o Hyperdrive é criado com o cache desligado (dado que muda por ação do usuário).
// O comando gerado referencia a URL do banco por variável de ambiente: nenhum segredo no código.

const raizDoPacote = resolve(import.meta.dirname, '..');
const executar = promisify(execFile);

describe('comando de criação do Hyperdrive', () => {
  const comando = comandoCriarHyperdrive();
  const partes = comando.split(' ');

  it('cria o Hyperdrive com --caching-disabled', () => {
    expect(comando.startsWith('wrangler hyperdrive create ')).toBe(true);
    expect(partes).toContain('--caching-disabled');
  });

  it('não liga nenhuma opção de cache (--max-age, --swr)', () => {
    expect(comando).not.toMatch(/--max-age|--swr/);
  });

  it('lê a URL do banco de uma variável de ambiente, sem valor literal', () => {
    expect(partes).toContain(`--connection-string="$${VARIAVEL_CONEXAO}"`);
    expect(comando).not.toMatch(/postgres(ql)?:\/\//);
    expect(comando).not.toContain('@');
  });

  it('o código-fonte não traz URL de banco nem senha', () => {
    const fonte = readFileSync(resolve(raizDoPacote, 'src/hyperdrive.ts'), 'utf8');
    expect(fonte).not.toMatch(/postgres(ql)?:\/\//);
    expect(fonte).not.toMatch(/password|senha\s*[:=]/i);
  });

  it('a variável da URL está documentada no .env.example como segredo e sem valor', () => {
    const exemplo = readFileSync(resolve(raizDoPacote, '../../.env.example'), 'utf8');
    expect(exemplo).toMatch(new RegExp(`^# ${VARIAVEL_CONEXAO} \\|.*\\| segredo$`, 'm'));
    expect(exemplo).toMatch(new RegExp(`^${VARIAVEL_CONEXAO}=$`, 'm'));
  });

  // A URL de exemplo não tem senha e o host é fictício: o comando não conecta em nada.
  const urlValida =
    'postgresql://app@ep-exemplo-123456.sa-east-1.aws.neon.tech/banco?sslmode=require';

  it('a linha de comando só imprime o comando, sem executar nada', async () => {
    const { stdout } = await executar(process.execPath, ['src/hyperdrive.ts'], {
      cwd: raizDoPacote,
      env: { ...process.env, [VARIAVEL_CONEXAO]: urlValida },
    });
    expect(stdout).toContain(comando);
  });

  it.each([
    ['ausente', undefined],
    ['do pooler', urlValida.replace('ep-exemplo-123456', 'ep-exemplo-123456-pooler')],
    ['sem TLS', urlValida.replace('?sslmode=require', '')],
    ['local', 'postgresql://app@localhost:5433/banco?sslmode=require'],
  ])('a linha de comando recusa a NEON_URL_APP %s e não imprime o comando', async (_caso, url) => {
    const ambiente: NodeJS.ProcessEnv = { ...process.env };
    delete ambiente[VARIAVEL_CONEXAO];
    if (url !== undefined) ambiente[VARIAVEL_CONEXAO] = url;

    const execucao = executar(process.execPath, ['src/hyperdrive.ts'], {
      cwd: raizDoPacote,
      env: ambiente,
    });

    await expect(execucao).rejects.toMatchObject({ code: 1, stdout: '' });
    await expect(execucao).rejects.toMatchObject({
      stderr: expect.stringContaining(VARIAVEL_CONEXAO),
    });
  });

  it('comandoValidado devolve o comando só com uma URL válida', () => {
    expect(comandoValidado({ [VARIAVEL_CONEXAO]: urlValida })).toBe(comando);
    expect(() => comandoValidado({})).toThrow(UrlNeonRecusada);
  });
});

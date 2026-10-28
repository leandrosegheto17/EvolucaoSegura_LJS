import { resolve } from 'node:path';
import pg from 'pg';
import { migrar } from '../../scripts/src/migrar.ts';
import { exigirHostLocal } from '../../scripts/src/seguranca/trava-host.ts';
import { nomeBancoTemporario, urlComBanco, urlServidorTeste } from '../vitest.urls.ts';

// globalSetup dos testes da API (roda no Node, antes do runtime do Worker): cria um banco
// TEMPORÁRIO no Postgres local (ou do CI), aplica as migrations nele e libera o login da role evolucao_app,
// para o binding HYPERDRIVE dos testes conectar como em produção (sujeito ao RLS). No fim da
// execução o banco é apagado. A senha 'evolucao_app' é de teste local, como a do postgres no
// docker-compose; em produção o login é provisionado fora do repositório. Trava de host: só o
// Postgres local; a troca de senha de role nunca chega a um banco remoto (no Neon, mudaria a
// senha da role do app de produção).

const NOME_VALIDO = /^es_api_[a-z0-9_]+$/;

// Cria o banco `nome` no servidor de `urlServidor`, migra e devolve a função que o apaga.
export async function prepararBancoEm(
  urlServidor: string,
  nome: string,
): Promise<() => Promise<void>> {
  exigirHostLocal(urlServidor);
  if (!NOME_VALIDO.test(nome)) throw new Error(`Nome de banco temporário inválido: ${nome}`);
  const urlManutencao = urlComBanco(urlServidor, 'postgres');
  const urlBanco = urlComBanco(urlServidor, nome);

  const servidor = new pg.Client({ connectionString: urlManutencao });
  await servidor.connect();
  try {
    await servidor.query(`create database ${nome}`);
  } finally {
    await servidor.end();
  }
  const apagar = async (): Promise<void> => {
    const limpeza = new pg.Client({ connectionString: urlManutencao });
    await limpeza.connect();
    try {
      await limpeza.query(`drop database if exists ${nome} with (force)`);
    } finally {
      await limpeza.end();
    }
  };

  try {
    await migrar({
      urlBanco,
      pasta: resolve(import.meta.dirname, '../../scripts/migrations'),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const admin = new pg.Client({ connectionString: urlBanco });
    await admin.connect();
    try {
      await admin.query("alter role evolucao_app with login password 'evolucao_app'");
    } finally {
      await admin.end();
    }
  } catch (erro) {
    await apagar();
    throw erro;
  }
  return apagar;
}

// O Vitest chama o globalSetup com o projeto como argumento e roda a função devolvida no fim.
export default async function prepararBanco(): Promise<() => Promise<void>> {
  return prepararBancoEm(urlServidorTeste, nomeBancoTemporario);
}

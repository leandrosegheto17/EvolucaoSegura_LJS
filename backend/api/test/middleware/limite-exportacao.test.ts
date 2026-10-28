import {
  LIMITE_EXPORTACOES,
  PROBLEMA_LIMITE_EXPORTACAO,
  type PaginaExportacao,
} from '@es/contrato/exportacao';
import { esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, pedir, semearPaciente } from '../rotas/pacientes-apoio.ts';

// T172 / EXP-05: mais de 5 exportações completas iniciadas em 60 segundos responde 429; a
// primeira página (sem cursor) é o início e conta; as páginas seguintes (com cursor) não contam;
// o contador fica na tabela limite_uso (chave 'exportacao'). A rota do prontuário não conta.

const LENTO = { timeout: 60_000 };

const iniciar = (sessao: Sessao) => pedir('GET', '/api/exportacao?limite=1', sessao);

const contador = async (usuarioId: string) =>
  (
    await comoAdmin<{ contagem: number }>(
      `select contagem from limite_uso where usuario_id = $1 and chave = 'exportacao'`,
      [usuarioId],
    )
  )[0]?.contagem ?? null;

async function iniciarVezes(sessao: Sessao, vezes: number) {
  const status: number[] = [];
  for (let i = 0; i < vezes; i++) status.push((await iniciar(sessao)).status);
  return status;
}

describe('limite de exportações iniciadas (EXP-05)', LENTO, () => {
  it('5 inícios em 60 s passam; o sexto responde 429 e o contador fica na tabela', async () => {
    const s = await sessaoDeTeste();
    expect(await iniciarVezes(s, LIMITE_EXPORTACOES)).toEqual([200, 200, 200, 200, 200]);
    expect(await contador(s.usuarioId)).toBe(5);
    const sexto = await iniciar(s);
    expect(sexto.status).toBe(429);
    const corpo = await sexto.json();
    expect(corpo).toEqual(PROBLEMA_LIMITE_EXPORTACAO);
    expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  });

  it('as páginas seguintes (com cursor) não contam como início', async () => {
    const s = await sessaoDeTeste();
    await semearPaciente(s.usuarioId);
    let pagina = (await (await iniciar(s)).json()) as PaginaExportacao;
    for (let i = 0; i < 8 && pagina.proximo_cursor; i++) {
      const resposta = await pedir(
        'GET',
        `/api/exportacao?limite=1&cursor=${pagina.proximo_cursor}`,
        s,
      );
      expect(resposta.status).toBe(200);
      pagina = (await resposta.json()) as PaginaExportacao;
    }
    expect(await contador(s.usuarioId)).toBe(1);
  });

  it('no limite, a exportação já iniciada continua pelas páginas seguintes', async () => {
    const s = await sessaoDeTeste();
    const primeira = (await (await iniciar(s)).json()) as PaginaExportacao;
    await iniciarVezes(s, LIMITE_EXPORTACOES - 1);
    expect((await iniciar(s)).status).toBe(429);
    const seguinte = await pedir(
      'GET',
      `/api/exportacao?limite=1&cursor=${primeira.proximo_cursor}`,
      s,
    );
    expect(seguinte.status).toBe(200);
  });

  it('passados 60 s do primeiro início, a janela recomeça', async () => {
    const s = await sessaoDeTeste();
    await iniciarVezes(s, LIMITE_EXPORTACOES);
    expect((await iniciar(s)).status).toBe(429);
    await comoAdmin(
      `update limite_uso set janela_inicio = now() - interval '61 seconds'
       where usuario_id = $1 and chave = 'exportacao'`,
      [s.usuarioId],
    );
    expect((await iniciar(s)).status).toBe(200);
    expect(await contador(s.usuarioId)).toBe(1);
  });

  it('o limite de um profissional não alcança outro', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    await iniciarVezes(a, LIMITE_EXPORTACOES + 1);
    expect((await iniciar(b)).status).toBe(200);
    expect(await contador(b.usuarioId)).toBe(1);
  });
});

describe('a rota do prontuário não conta no limite (EXP-05)', LENTO, () => {
  it('exportar o prontuário mais de 5 vezes não mexe no contador nem impede o início', async () => {
    const s = await sessaoDeTeste();
    const paciente = await semearPaciente(s.usuarioId);
    for (let i = 0; i < LIMITE_EXPORTACOES + 1; i++)
      expect((await pedir('GET', `/api/pacientes/${paciente}/prontuario`, s)).status).toBe(200);
    expect(await contador(s.usuarioId)).toBeNull();
    expect(await iniciarVezes(s, LIMITE_EXPORTACOES)).toEqual([200, 200, 200, 200, 200]);
  });
});

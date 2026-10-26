import { comoAdmin } from '../apoio.ts';

// Apoio dos testes das rotas da agenda (T78 a T82): sessão e perfil semeados direto no banco
// pelo superusuário, e leitura das sessões que a app grava.

type Status = 'agendada' | 'realizada' | 'faltou' | 'cancelada' | 'remarcada';

export async function semearSessao(
  usuarioId: string,
  pacienteId: string,
  dados: { inicio: string; fim: string; status?: Status; cobravel?: boolean },
): Promise<string> {
  const [linha] = await comoAdmin<{ id: string }>(
    `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim, status, cobravel)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      usuarioId,
      pacienteId,
      dados.inicio,
      dados.fim,
      dados.status ?? 'agendada',
      dados.cobravel ?? false,
    ],
  );
  return linha!.id;
}

export async function semearPerfil(
  usuarioId: string,
  dados: { atende_sabado?: boolean; atende_domingo?: boolean } = {},
): Promise<void> {
  await comoAdmin(
    `insert into perfil (usuario_id, nome, atende_sabado, atende_domingo, especialidade)
     values ($1, 'Dra. Ana', $2, $3, 'psicologia')`,
    [usuarioId, dados.atende_sabado ?? false, dados.atende_domingo ?? false],
  );
}

export interface LinhaSessaoBanco {
  id: string;
  usuario_id: string;
  paciente_id: string;
  serie_id: string | null;
  inicio: string;
  fim: string;
  link: string | null;
  status: Status;
  cobravel: boolean;
  row_version: number;
}

const COLUNAS = `id, usuario_id, paciente_id, serie_id,
  to_char(inicio at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as inicio,
  to_char(fim at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as fim,
  link, status, cobravel, row_version`;

export const linhaSessao = async (id: string): Promise<LinhaSessaoBanco | undefined> =>
  (
    await comoAdmin<LinhaSessaoBanco>(`select ${COLUNAS} from sessao_atendimento where id = $1`, [
      id,
    ])
  )[0];

export const sessoesDe = (usuarioId: string): Promise<LinhaSessaoBanco[]> =>
  comoAdmin<LinhaSessaoBanco>(
    `select ${COLUNAS} from sessao_atendimento where usuario_id = $1 order by inicio, id`,
    [usuarioId],
  );

import { type EventoAuditoria, esquemaEventoAuditoria } from '@es/contrato/auditoria';
import type { Trx } from '../db.ts';

// AUD-01, AUD-02: grava o evento na transação da requisição. Erro de validação ou do banco
// propaga e o comTransacao desfaz a operação inteira. Nunca grava conteúdo clínico: o contrato
// recusa chave extra e aceita só nomes de campo. Adaptado de audit-event.ts do legado.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// /24 para IPv4 e /48 para IPv6; entrada ausente ou não reconhecida vira null.
export function truncarIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = IPV4.exec(ip);
  if (v4) {
    if (v4.slice(1).some((octeto) => Number(octeto) > 255)) return null;
    return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  }
  const grupos = gruposIpv6(ip);
  if (!grupos) return null;
  return `${grupos.slice(0, 3).join(':')}::/48`;
}

// Expande o "::" e devolve os 8 grupos sem zeros à esquerda; null se não for IPv6.
function gruposIpv6(ip: string): string[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip)) return null;
  const partes = ip.split('::');
  if (partes.length > 2) return null;
  const separar = (trecho: string | undefined): string[] => (trecho ? trecho.split(':') : []);
  const inicio = separar(partes[0]);
  const fim = separar(partes[1]);
  const faltam = 8 - inicio.length - fim.length;
  if (partes.length === 1 ? faltam !== 0 : faltam < 1) return null;
  const grupos = [...inicio, ...Array<string>(partes.length === 1 ? 0 : faltam).fill('0'), ...fim];
  if (grupos.some((grupo) => !/^[0-9a-f]{1,4}$/i.test(grupo))) return null;
  return grupos.map((grupo) => parseInt(grupo, 16).toString(16));
}

// Só produto e versão principal (ex.: "Mozilla/5"), até 80 caracteres.
export function resumirUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const produto = /([A-Za-z][A-Za-z0-9._-]*\/\d+)/.exec(ua);
  return (produto?.[1] ?? 'desconhecido').slice(0, 80);
}

export async function registrarAuditoria(trx: Trx, entrada: EventoAuditoria): Promise<void> {
  const evento = esquemaEventoAuditoria.parse(entrada);
  await trx
    .insertInto('audit_log')
    .values({
      usuario_id: evento.usuarioId,
      ator: evento.ator,
      acao: evento.acao,
      alvo_tipo: evento.alvoTipo,
      alvo_id: evento.alvoId ?? null,
      campos_alterados: [...new Set(evento.camposAlterados ?? [])],
      origem_ip: truncarIp(evento.ip),
      origem_ua: resumirUserAgent(evento.userAgent),
    })
    .execute();
}

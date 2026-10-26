import type { Rascunho } from '@es/contrato/clinico';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ehErroApi } from '../../lib/api.ts';
import type { AutosaveEstado } from '../../ui/new';
import { gravarRascunho, lerRascunho } from './api.ts';

// RAS-01, RAS-02, RAS-04: autosave do texto da evolução no servidor, portado de useAutosave.ts do
// legado. O rascunho vive só no servidor (sem localStorage nem IndexedDB). Gravação com atraso de
// 2 s e If-Match (RAS-02). No próximo acesso, se o servidor guarda um texto diferente do que a
// tela carregou (a sessão expirou com texto não salvo), a tela OFERECE restaurar; nada é aplicado
// sem o clique (RAS-04). Dado clínico: o texto nunca vai para log, console nem mensagem de erro.
// SPEC_DEVIATION: o legado restaurava o rascunho sozinho e mostrava "Rascunho restaurado"; aqui a
// restauração é oferecida (RAS-04: "oferecer restaurar"), para nunca trocar texto sem o aceite.

export const ATRASO_AUTOSAVE_MS = 2000;
export const TIPO_RASCUNHO = 'evolucao';

const hhmm = (d: Date) =>
  d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

const textoDe = (r: Rascunho | null): string | null =>
  r !== null && typeof r.payload['texto'] === 'string' ? r.payload['texto'] : null;

// `base` é o texto que a tela carregou (o do servidor ou vazio); `ref` é UUID (evolução, sessão ou
// paciente).
export function useRascunhoTexto(ref: string, texto: string, base: string, ativo = true) {
  const [estado, setEstado] = useState<AutosaveEstado>('salvo');
  const [salvoAs, setSalvoAs] = useState<string>();
  const [oferta, setOferta] = useState<Rascunho | null>(null);
  const [conflito, setConflito] = useState(false);
  const versao = useRef(0);
  const pronto = useRef<Promise<void>>(Promise.resolve());
  const pausado = useRef(false);
  const gravado = useRef(base);
  const textoAtual = useRef(texto);
  textoAtual.current = texto;
  const ofertaPendente = oferta !== null;

  const ofertar = useCallback((r: Rascunho | null) => {
    versao.current = r?.row_version ?? versao.current;
    const t = textoDe(r);
    setOferta(r !== null && t !== null && t.trim() !== '' && t !== textoAtual.current ? r : null);
  }, []);

  useEffect(() => {
    if (!ativo) return;
    const ctl = new AbortController();
    pronto.current = lerRascunho(TIPO_RASCUNHO, ref, ctl.signal)
      .then((r) => {
        if (!ctl.signal.aborted) {
          versao.current = r?.row_version ?? 0;
          const t = textoDe(r);
          setOferta(r !== null && t !== null && t.trim() !== '' && t !== base ? r : null);
        }
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [ref, base, ativo]);

  const gravar = useCallback(
    async (valor: string) => {
      await pronto.current;
      setEstado('salvando');
      try {
        const r = await gravarRascunho(TIPO_RASCUNHO, ref, { texto: valor }, versao.current);
        versao.current = r.row_version;
        gravado.current = valor;
        setSalvoAs(hhmm(new Date()));
        setEstado('salvo');
      } catch (e) {
        setEstado('nao_salvo');
        if (ehErroApi(e) && e.status === 412) {
          pausado.current = true;
          setConflito(true);
        }
      }
    },
    [ref],
  );

  useEffect(() => {
    if (!ativo || ofertaPendente || pausado.current || texto === gravado.current) return;
    setEstado('nao_salvo');
    const t = setTimeout(() => void gravar(texto), ATRASO_AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [texto, ativo, ofertaPendente, gravar]);

  const sujo = estado !== 'salvo';
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  return {
    estado,
    salvoAs,
    oferta,
    conflito,
    // Aceita a oferta: devolve o texto do rascunho (o servidor já o guarda).
    restaurar: (): string | null => {
      const t = textoDe(oferta);
      if (t !== null) gravado.current = t;
      setOferta(null);
      return t;
    },
    descartar: () => setOferta(null),
    // "Recarregar versão atual" do conflito (412): relê o rascunho e retoma o autosave.
    recarregar: async () => {
      const r = await lerRascunho(TIPO_RASCUNHO, ref).catch(() => null);
      ofertar(r);
      pausado.current = false;
      setConflito(false);
    },
    fecharConflito: () => setConflito(false),
    // Depois de gravar a evolução, alinha o rascunho ao texto gravado (a API não apaga rascunho),
    // para o próximo acesso não oferecer um texto antigo. Melhor esforço.
    alinhar: async (valor: string) => {
      if (!ativo || pausado.current || valor === gravado.current) return;
      await gravar(valor);
    },
  };
}

import type { Configuracoes } from '@es/contrato/configuracoes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Alert, Button, Skeleton, Spinner } from '../../ui';
import { useSignOut } from '../sair.ts';
import { ThemeSwitch } from '../shell/ThemeSwitch.tsx';
import { setTheme, useEffectiveTheme } from '../theme.ts';
import { CHAVE_CONFIGURACOES, lerConfiguracoes, salvarConfiguracoes } from './api.ts';

// PERF-08: tela de Configurações, portada de app/settings/SettingsPage.tsx do legado. Ficam os
// cartões Aparência, Privacidade da agenda e Sessão, na mesma ordem. Saem os cartões Inatividade
// (fixa em 15 min, sem opção, PERF-08) e Inteligência artificial (fora do escopo). Comportamento
// do legado mantido: privacidade_agenda desligada = agenda com o nome completo; ligada = iniciais;
// cada mudança salva na hora.

type Save = 'idle' | 'saving' | 'ok' | 'err';

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h2 id={id} className="font-heading text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const logout = useSignOut();
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_CONFIGURACOES,
    queryFn: ({ signal }) => lerConfiguracoes(signal),
  });
  const s = consulta.data;
  const [save, setSave] = useState<Save>('idle');
  const { efetivo, escolhaExplicita } = useEffectiveTheme();
  const themeBox = useRef<HTMLDivElement>(null);
  const [themeMsg, setThemeMsg] = useState('');
  const followSystem = () => {
    setTheme('system');
    themeBox.current?.querySelector<HTMLElement>('[role="switch"]')?.focus();
    setThemeMsg('O tema agora segue o aparelho.');
  };

  const update = useCallback(
    async (next: Configuracoes) => {
      setSave('saving');
      try {
        qc.setQueryData(CHAVE_CONFIGURACOES, await salvarConfiguracoes(next));
        setSave('ok');
      } catch {
        setSave('err');
      }
    },
    [qc],
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold">Configurações</h1>
        <p className="text-mut">Privacidade da agenda e aparência.</p>
      </header>

      <div role="status" aria-live="polite">
        {save === 'saving' && <Spinner label="Salvando" />}
        {save === 'ok' && <Alert tone="ok">Configuração salva.</Alert>}
      </div>
      {save === 'err' && <Alert tone="err">Não foi possível salvar agora. Tente novamente.</Alert>}

      <Card id="cfg-theme" title="Aparência">
        <div ref={themeBox}>
          <ThemeSwitch />
        </div>
        <p className="text-mut">
          {escolhaExplicita
            ? `Você escolheu o tema ${efetivo === 'dark' ? 'escuro' : 'claro'}.`
            : `Seguindo o tema do aparelho (agora: ${efetivo === 'dark' ? 'escuro' : 'claro'}).`}
        </p>
        {escolhaExplicita && (
          <div>
            <Button type="button" variant="outline" onClick={followSystem}>
              Seguir o tema do aparelho
            </Button>
          </div>
        )}
        <div role="status" aria-live="polite" className="text-mut">
          {themeMsg}
        </div>
      </Card>

      {consulta.isPending && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Spinner label="Carregando configurações" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {consulta.isError && (
        <div className="flex flex-col gap-3">
          <Alert tone="err">Não foi possível carregar as configurações.</Alert>
          <Button type="button" onClick={() => void consulta.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {s && (
        <>
          <Card id="cfg-priv" title="Privacidade da agenda">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                role="switch"
                checked={s.privacidade_agenda}
                disabled={save === 'saving'}
                onChange={(e) => void update({ privacidade_agenda: e.target.checked })}
              />
              <span>Mostrar apenas iniciais dos pacientes na agenda</span>
            </label>
            <p className="text-mut">
              {s.privacidade_agenda ? 'Agenda exibe iniciais.' : 'Agenda exibe o nome completo.'}
            </p>
          </Card>

          <Card id="cfg-session" title="Sessão">
            <div>
              <Button type="button" variant="outline" onClick={logout}>
                Encerrar sessão
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

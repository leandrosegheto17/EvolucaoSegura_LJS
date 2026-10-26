import type { Evolucao, ModeloTexto, Rascunho } from '@es/contrato/clinico';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { EvolucaoPage, ModelosTextoPage } from './evolucao.tsx';

// T106 / EVO-01, EVO-04, EVO-05, RAS-03, RAS-04: evolução do paciente (registro ligado à sessão,
// edição no dia, retificação com motivo e histórico), autosave do rascunho e modelos de texto.
// Casos de EvolutionPage.spec, rectify.spec e autosave.spec do legado que valem com o contrato novo.
// Dado clínico: nenhuma mensagem de erro repete o texto digitado.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  definirCsrf(null);
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const problema = (status: number, codigo: string) => json({ codigo, titulo: 'x', status }, status);

const HOJE: Evolucao = {
  id: 'ev1',
  paciente_id: 'p1',
  sessao_id: null,
  texto: 'Paciente relatou melhora',
  estado: 'editavel_hoje',
  editavel_ate: '2026-10-27T02:59:59.999Z',
  row_version: 4,
  criado_em: '2026-10-26T12:00:00.000Z',
  versao_vigente: 0,
  retificacoes: [],
};
const REGISTRADA: Evolucao = { ...HOJE, id: 'ev2', estado: 'registrada' };
const RETIFICADA: Evolucao = {
  ...REGISTRADA,
  versao_vigente: 1,
  retificacoes: [
    {
      seq: 1,
      texto: 'Texto corrigido',
      motivo: 'Erro de digitação',
      criado_em: '2026-10-27T12:00:00.000Z',
    },
  ],
};
const RASCUNHO: Rascunho = {
  tipo: 'evolucao',
  ref: 'ev1',
  payload: { texto: 'Texto digitado e nunca salvo' },
  row_version: 3,
  atualizado_em: '2026-10-26T15:30:00.000Z',
};
const MODELOS: ModeloTexto[] = [
  {
    id: 'm1',
    tipo: 'evolucao',
    nome: 'Retorno',
    corpo: 'Retorno em uma semana.',
    arquivado: false,
    row_version: 1,
  },
  {
    id: 'm2',
    tipo: 'evolucao',
    nome: 'Alta',
    corpo: 'Alta concedida.',
    arquivado: true,
    row_version: 1,
  },
];

type Chamada = { metodo: string; url: string; corpo: unknown; cabecalhos: Headers };
function mock(o: {
  evolucoes?: Evolucao[];
  paginas?: Record<number, Evolucao[]>;
  rascunho?: Rascunho | null;
  modelos?: ModeloTexto[];
  // Resposta das escritas e leituras especiais: por "METODO url".
  rotas?: Record<string, (c: Chamada) => Response>;
  falhaLeitura?: boolean;
}) {
  const chamadas: Chamada[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const c = { metodo, url, corpo, cabecalhos: new Headers(init?.headers) };
    chamadas.push(c);
    if (url === '/api/eu') return json({ csrf_token: 'csrf' });
    const rota = o.rotas?.[`${metodo} ${url}`];
    if (rota) return rota(c);
    if (o.falhaLeitura) return problema(500, 'erro');
    const pagina = /^\/api\/pacientes\/p1\/evolucoes\?limit=50&offset=(\d+)$/.exec(url);
    if (pagina) {
      const offset = Number(pagina[1]);
      const items = o.paginas ? (o.paginas[offset] ?? []) : offset === 0 ? (o.evolucoes ?? []) : [];
      return json({ items, limit: 50, offset });
    }
    if (url.startsWith('/api/modelos-texto?arquivados=')) {
      const todos = url.endsWith('true');
      return json({ items: (o.modelos ?? MODELOS).filter((m) => todos || !m.arquivado) });
    }
    if (url.startsWith('/api/rascunhos?')) return json({ items: o.rascunho ? [o.rascunho] : [] });
    if (metodo === 'PUT' && url.startsWith('/api/rascunhos/'))
      return json({ ...RASCUNHO, row_version: 9, payload: corpo }, 200);
    return problema(404, 'nao_encontrado');
  });
  vi.stubGlobal('fetch', f);
  return chamadas;
}
const escritas = (c: Chamada[], prefixo = '') =>
  c.filter((x) => x.metodo !== 'GET' && x.url !== '/api/eu' && x.url.startsWith(`/api/${prefixo}`));

const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const setupEvolucao = (busca = '') =>
  render(
    <QueryClientProvider client={cliente()}>
      <MemoryRouter initialEntries={[`/app/pacientes/p1/evolucao${busca}`]}>
        <Routes>
          <Route path="/app/pacientes/:id/evolucao" element={<EvolucaoPage />} />
          <Route path="/app/modelos-texto" element={<p>tela dos modelos</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const setupModelos = () =>
  render(
    <QueryClientProvider client={cliente()}>
      <MemoryRouter initialEntries={['/app/modelos-texto']}>
        <Routes>
          <Route path="/app/modelos-texto" element={<ModelosTextoPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const digitar = (rotulo: string | RegExp, valor: string) =>
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });

describe('Rascunho oferecido depois da sessão expirar (RAS-04)', () => {
  it('com texto não salvo no servidor, oferece restaurar sem aplicar nem gravar sozinho', async () => {
    const chamadas = mock({ evolucoes: [HOJE], rascunho: RASCUNHO });
    setupEvolucao();
    expect(await screen.findByText(/Há um rascunho não salvo desta evolução/)).toBeTruthy();
    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Paciente relatou melhora',
    );
    expect(escritas(chamadas)).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar rascunho' }));

    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Texto digitado e nunca salvo',
    );
    expect(screen.queryByText(/Há um rascunho não salvo/)).toBeNull();
    expect(chamadas.some((c) => c.url === '/api/rascunhos?tipo=evolucao&ref=ev1')).toBe(true);
  });

  it('descartar mantém o texto da evolução e fecha o aviso', async () => {
    mock({ evolucoes: [HOJE], rascunho: RASCUNHO });
    setupEvolucao();
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar rascunho' }));
    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Paciente relatou melhora',
    );
    expect(screen.queryByText(/Há um rascunho não salvo/)).toBeNull();
  });

  it('rascunho igual ao texto já salvo não gera oferta', async () => {
    mock({ evolucoes: [HOJE], rascunho: { ...RASCUNHO, payload: { texto: HOJE.texto } } });
    setupEvolucao();
    await screen.findByLabelText('Texto da evolução');
    await waitFor(() => expect(screen.queryByText(/Há um rascunho não salvo/)).toBeNull());
  });

  it('no formulário de nova evolução também oferece o rascunho guardado (ref = paciente)', async () => {
    const chamadas = mock({
      evolucoes: [],
      rascunho: { ...RASCUNHO, ref: 'p1', payload: { texto: 'Rascunho da nova evolução' } },
    });
    setupEvolucao();
    await userEvent.click(await screen.findByRole('button', { name: 'Restaurar rascunho' }));
    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Rascunho da nova evolução',
    );
    expect(chamadas.some((c) => c.url === '/api/rascunhos?tipo=evolucao&ref=p1')).toBe(true);
  });
});

describe('Autosave do rascunho no servidor (RAS-01, RAS-02)', () => {
  it('grava após 2 s sem digitar, com If-Match 0 e depois com a versão devolvida', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const chamadas = mock({ evolucoes: [HOJE], rascunho: null });
    setupEvolucao();
    await screen.findByLabelText('Texto da evolução');

    digitar('Texto da evolução', 'Primeira versão');
    expect(escritas(chamadas, 'rascunhos')).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(2100));
    await waitFor(() => expect(escritas(chamadas, 'rascunhos')).toHaveLength(1));
    const primeira = escritas(chamadas, 'rascunhos')[0]!;
    expect(primeira.metodo).toBe('PUT');
    expect(primeira.url).toBe('/api/rascunhos/evolucao/ev1');
    expect(primeira.corpo).toEqual({ payload: { texto: 'Primeira versão' } });
    expect(primeira.cabecalhos.get('If-Match')).toBe('0');

    digitar('Texto da evolução', 'Segunda versão');
    await act(() => vi.advanceTimersByTimeAsync(2100));
    await waitFor(() => expect(escritas(chamadas, 'rascunhos')).toHaveLength(2));
    expect(escritas(chamadas, 'rascunhos')[1]!.cabecalhos.get('If-Match')).toBe('9');
    expect(await screen.findByText(/Salvo às/)).toBeTruthy();
  });

  it('412 PRECONDITION_FAILED avisa o conflito e não sobrescreve em silêncio', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock({
      evolucoes: [HOJE],
      rascunho: RASCUNHO,
      rotas: { 'PUT /api/rascunhos/evolucao/ev1': () => problema(412, 'PRECONDITION_FAILED') },
    });
    setupEvolucao();
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar rascunho' }));
    digitar('Texto da evolução', 'Outro texto');
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(await screen.findByText('Este registro foi alterado em outra sessão')).toBeTruthy();
    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Outro texto',
    );
  });
});

describe('Meia-noite com a tela aberta (EVO-04, EVO-05)', () => {
  it('EDIT_WINDOW_CLOSED recusa a gravação, mantém o texto e oferece retificar', async () => {
    const chamadas = mock({
      evolucoes: [HOJE],
      rotas: { 'PUT /api/evolucoes/ev1': () => problema(409, 'EDIT_WINDOW_CLOSED') },
    });
    setupEvolucao();
    await screen.findByLabelText('Texto da evolução');
    digitar('Texto da evolução', 'Texto escrito perto da meia-noite');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText(/O prazo de edição terminou à 00:00/)).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Retificar evolução' });
    expect((within(form).getByLabelText('Texto retificado') as HTMLTextAreaElement).value).toBe(
      'Texto escrito perto da meia-noite',
    );
    expect(escritas(chamadas, 'evolucoes')).toHaveLength(1);
  });

  it('salvar a retificação oferecida envia texto e motivo e avisa o sucesso', async () => {
    const chamadas = mock({
      evolucoes: [HOJE],
      rotas: {
        'PUT /api/evolucoes/ev1': () => problema(409, 'EDIT_WINDOW_CLOSED'),
        'POST /api/evolucoes/ev1/retificacoes': () => json(RETIFICADA, 201),
      },
    });
    setupEvolucao();
    await screen.findByLabelText('Texto da evolução');
    digitar('Texto da evolução', 'Texto novo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('form', { name: 'Retificar evolução' });
    digitar('Motivo da retificação', 'Virou a meia-noite');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar retificação' }));

    expect(
      await screen.findByText('Retificação registrada. O original continua no histórico.'),
    ).toBeTruthy();
    const post = escritas(chamadas, 'evolucoes/ev1/retificacoes')[0]!;
    expect(post.corpo).toEqual({ texto: 'Texto novo', motivo: 'Virou a meia-noite' });
  });
});

describe('Edição no dia do cadastro (EVO-04)', () => {
  it('mostra o selo "Editável hoje" e salva com o row_version lido', async () => {
    const chamadas = mock({
      evolucoes: [HOJE],
      rotas: {
        'PUT /api/evolucoes/ev1': () => json({ ...HOJE, texto: 'Texto salvo', row_version: 5 }),
      },
    });
    setupEvolucao();
    expect(await screen.findByText('Editável hoje')).toBeTruthy();
    expect(screen.getByText('Você pode editar até 23:59 de hoje.')).toBeTruthy();
    digitar('Texto da evolução', 'Texto salvo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Evolução salva.')).toBeTruthy();
    const put = escritas(chamadas, 'evolucoes/ev1')[0]!;
    expect(put.metodo).toBe('PUT');
    expect(put.corpo).toEqual({ texto: 'Texto salvo', row_version: 4 });
  });

  it('409 versao_divergente avisa que a evolução mudou e mantém o texto', async () => {
    mock({
      evolucoes: [HOJE],
      rotas: { 'PUT /api/evolucoes/ev1': () => problema(409, 'versao_divergente') },
    });
    setupEvolucao();
    await screen.findByLabelText('Texto da evolução');
    digitar('Texto da evolução', 'Meu texto');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/foi alterada em outro lugar/)).toBeTruthy();
    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Meu texto',
    );
  });

  it('erro do servidor mostra mensagem fixa, sem repetir o texto clínico', async () => {
    mock({ evolucoes: [HOJE], rotas: { 'PUT /api/evolucoes/ev1': () => problema(500, 'erro') } });
    setupEvolucao();
    await screen.findByLabelText('Texto da evolução');
    digitar('Texto da evolução', 'Segredo clínico do paciente');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível salvar.');
    expect(alerta.textContent).not.toContain('Segredo clínico');
  });
});

describe('Registro da evolução (EVO-01, EVO-02)', () => {
  it('sem evolução mostra o formulário e registra ligada à sessão da URL', async () => {
    const chamadas = mock({
      evolucoes: [],
      rotas: { 'POST /api/evolucoes': () => json({ ...HOJE, sessao_id: 's1' }, 201) },
    });
    setupEvolucao('?sessao=s1');
    expect(await screen.findByText('Nenhuma evolução registrada')).toBeTruthy();
    expect(screen.getByText(/pode ser editada até 23:59 de hoje/)).toBeTruthy();
    digitar('Texto da evolução', 'Primeira evolução');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar evolução' }));

    expect(await screen.findByText('Evolução registrada.')).toBeTruthy();
    const post = escritas(chamadas, 'evolucoes')[0]!;
    expect(post.corpo).toEqual({ paciente_id: 'p1', sessao_id: 's1', texto: 'Primeira evolução' });
  });

  it('sem sessão na URL registra com sessao_id nulo', async () => {
    const chamadas = mock({
      evolucoes: [],
      rotas: { 'POST /api/evolucoes': () => json(HOJE, 201) },
    });
    setupEvolucao();
    await screen.findByText('Nenhuma evolução registrada');
    digitar('Texto da evolução', 'Evolução avulsa');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar evolução' }));
    await screen.findByText('Evolução registrada.');
    expect(escritas(chamadas, 'evolucoes')[0]!.corpo).toEqual({
      paciente_id: 'p1',
      sessao_id: null,
      texto: 'Evolução avulsa',
    });
  });

  it('texto vazio é recusado na tela, sem chamar a API', async () => {
    const chamadas = mock({ evolucoes: [] });
    setupEvolucao();
    await screen.findByText('Nenhuma evolução registrada');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar evolução' }));
    expect(await screen.findByText('Escreva o texto da evolução.')).toBeTruthy();
    expect(escritas(chamadas, 'evolucoes')).toEqual([]);
  });

  it('409 EVOLUTION_EXISTS avisa que a sessão já tem evolução', async () => {
    mock({
      evolucoes: [],
      rotas: { 'POST /api/evolucoes': () => problema(409, 'EVOLUTION_EXISTS') },
    });
    setupEvolucao('?sessao=s1');
    await screen.findByText('Nenhuma evolução registrada');
    digitar('Texto da evolução', 'Outra evolução');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar evolução' }));
    expect(
      await screen.findByText('Esta sessão já tem evolução. Recarregue a página.'),
    ).toBeTruthy();
  });
});

describe('Retificação e histórico de versões (EVO-05)', () => {
  it('registrada mostra o selo, o texto somente leitura e Retificar, sem editar nem apagar', async () => {
    mock({ evolucoes: [REGISTRADA] });
    setupEvolucao();
    expect(await screen.findByText('Registrada')).toBeTruthy();
    expect(screen.getByText('Paciente relatou melhora')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retificar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Apagar|Excluir/ })).toBeNull();
  });

  it('retificar exige o motivo e envia texto e motivo', async () => {
    const chamadas = mock({
      evolucoes: [REGISTRADA],
      rotas: { 'POST /api/evolucoes/ev2/retificacoes': () => json(RETIFICADA, 201) },
    });
    setupEvolucao();
    await userEvent.click(await screen.findByRole('button', { name: 'Retificar' }));
    digitar('Texto retificado', 'Texto corrigido');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar retificação' }));
    expect(await screen.findByText('Informe o motivo da retificação.')).toBeTruthy();
    expect(escritas(chamadas, 'evolucoes')).toEqual([]);

    digitar('Motivo da retificação', 'Erro de digitação');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar retificação' }));
    expect(
      await screen.findByText('Retificação registrada. O original continua no histórico.'),
    ).toBeTruthy();
    expect(escritas(chamadas, 'evolucoes')[0]!.corpo).toEqual({
      texto: 'Texto corrigido',
      motivo: 'Erro de digitação',
    });
  });

  it.each([
    ['EDIT_WINDOW_OPEN', 409, /ainda pode ser editada hoje/],
    ['RECTIFICATION_CONFLICT', 409, /Outra retificação foi salva antes/],
    ['sem_conteudo_novo', 400, /precisa alterar o texto/],
    ['validacao', 422, /inválido ou grande demais/],
  ])(
    'erro %s da retificação mostra mensagem própria sem repetir o texto',
    async (codigo, status, msg) => {
      mock({
        evolucoes: [REGISTRADA],
        rotas: { 'POST /api/evolucoes/ev2/retificacoes': () => problema(status, codigo) },
      });
      setupEvolucao();
      await userEvent.click(await screen.findByRole('button', { name: 'Retificar' }));
      digitar('Texto retificado', 'Conteúdo sigiloso novo');
      digitar('Motivo da retificação', 'Motivo sigiloso');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar retificação' }));
      const form = screen.getByRole('form', { name: 'Retificar evolução' });
      const alerta = await within(form).findByText(msg);
      expect(alerta.closest('[role]')?.textContent).not.toContain('sigiloso');
    },
  );

  it('histórico mostra a original e cada retificação com data, motivo e a marca de vigente', async () => {
    mock({ evolucoes: [RETIFICADA] });
    setupEvolucao();
    expect(await screen.findByText('Texto corrigido')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ver histórico de versões' }));
    const lista = screen.getByRole('list', { name: 'Histórico de versões' });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    expect(itens[0]!.textContent).toContain('Original');
    expect(itens[0]!.textContent).toContain('Paciente relatou melhora');
    expect(itens[0]!.textContent).not.toContain('Vigente');
    expect(itens[1]!.textContent).toContain('Retificação 1');
    expect(itens[1]!.textContent).toContain('Motivo: Erro de digitação');
    expect(itens[1]!.textContent).toContain('Vigente');
  });

  it('lista paginada: "Carregar mais" busca a próxima página pelo offset', async () => {
    const cheia = Array.from({ length: 50 }, (_, i) => ({ ...REGISTRADA, id: `r${i}` }));
    const chamadas = mock({ paginas: { 0: cheia, 50: [{ ...REGISTRADA, id: 'ultima' }] } });
    setupEvolucao();
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais evoluções' }));
    await waitFor(() =>
      expect(chamadas.some((c) => c.url === '/api/pacientes/p1/evolucoes?limit=50&offset=50')).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Carregar mais evoluções' })).toBeNull(),
    );
  });

  it('falha ao carregar mostra mensagem fixa e Tentar novamente', async () => {
    mock({ falhaLeitura: true });
    setupEvolucao();
    expect(await screen.findByText('Não foi possível carregar as evoluções.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('não tem violações de acessibilidade no registro e na edição do dia', async () => {
    mock({ evolucoes: [HOJE, REGISTRADA] });
    const { container } = setupEvolucao();
    await screen.findByText('Editável hoje');
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Modelos de texto na evolução (RAS-03)', () => {
  it('escolher um modelo coloca o corpo no texto, depois do que já foi digitado', async () => {
    mock({ evolucoes: [] });
    setupEvolucao();
    await screen.findByLabelText('Texto da evolução');
    const seletor = await screen.findByLabelText('Modelo');
    expect(within(seletor).queryByRole('option', { name: 'Alta' })).toBeNull();
    await userEvent.selectOptions(seletor, 'm1');
    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Retorno em uma semana.',
    );
    digitar('Texto da evolução', 'Anotação');
    await userEvent.selectOptions(screen.getByLabelText('Modelo'), 'm1');
    expect((screen.getByLabelText('Texto da evolução') as HTMLTextAreaElement).value).toBe(
      'Anotação\n\nRetorno em uma semana.',
    );
  });
});

describe('Tela dos modelos de texto (RAS-03)', () => {
  it('lista os modelos não arquivados e mostra os arquivados sob pedido', async () => {
    const chamadas = mock({});
    setupModelos();
    expect(await screen.findByText('Retorno')).toBeTruthy();
    expect(screen.queryByText('Alta')).toBeNull();
    await userEvent.click(screen.getByLabelText('Mostrar arquivados'));
    expect(await screen.findByText('Alta')).toBeTruthy();
    expect(screen.getByText('Arquivado')).toBeTruthy();
    expect(chamadas.some((c) => c.url === '/api/modelos-texto?arquivados=true')).toBe(true);
  });

  it('cria o modelo com tipo evolucao, nome e corpo', async () => {
    const chamadas = mock({
      rotas: {
        'POST /api/modelos-texto': () =>
          json({ ...MODELOS[0], id: 'm3', nome: 'Novo', corpo: 'Corpo novo' }, 201),
      },
    });
    setupModelos();
    await screen.findByText('Retorno');
    digitar(/^Nome do modelo/, '  Novo  ');
    digitar('Texto do modelo', 'Corpo novo');
    await userEvent.click(screen.getByRole('button', { name: 'Criar modelo' }));
    await waitFor(() => expect(escritas(chamadas, 'modelos-texto')).toHaveLength(1));
    expect(escritas(chamadas, 'modelos-texto')[0]!.corpo).toEqual({
      tipo: 'evolucao',
      nome: 'Novo',
      corpo: 'Corpo novo',
    });
  });

  it('nome repetido (409 TEMPLATE_NAME_EXISTS) mostra aviso próprio', async () => {
    mock({
      rotas: { 'POST /api/modelos-texto': () => problema(409, 'TEMPLATE_NAME_EXISTS') },
    });
    setupModelos();
    await screen.findByText('Retorno');
    digitar(/^Nome do modelo/, 'retorno');
    await userEvent.click(screen.getByRole('button', { name: 'Criar modelo' }));
    expect(await screen.findByText('Já existe um modelo com este nome.')).toBeTruthy();
  });

  it('nome vazio é recusado na tela, sem chamar a API', async () => {
    const chamadas = mock({});
    setupModelos();
    await screen.findByText('Retorno');
    await userEvent.click(screen.getByRole('button', { name: 'Criar modelo' }));
    expect(await screen.findByText('Informe o nome do modelo.')).toBeTruthy();
    expect(escritas(chamadas, 'modelos-texto')).toEqual([]);
  });

  it('edita nome e corpo com PUT que mantém o estado de arquivamento', async () => {
    const chamadas = mock({
      rotas: {
        'PUT /api/modelos-texto/m1': () => json({ ...MODELOS[0], nome: 'Retorno 2' }),
      },
    });
    setupModelos();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Retorno' }));
    const form = screen.getByRole('form', { name: 'Editar modelo Retorno' });
    fireEvent.change(within(form).getByLabelText(/Nome do modelo/), {
      target: { value: 'Retorno 2' },
    });
    fireEvent.change(within(form).getByLabelText('Texto do modelo'), {
      target: { value: 'Novo corpo' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar modelo' }));
    await waitFor(() => expect(escritas(chamadas, 'modelos-texto')).toHaveLength(1));
    expect(escritas(chamadas, 'modelos-texto')[0]!.corpo).toEqual({
      nome: 'Retorno 2',
      corpo: 'Novo corpo',
      arquivado: false,
    });
  });

  it('arquivar envia arquivado verdadeiro em vez de apagar; não há opção de excluir', async () => {
    const chamadas = mock({
      rotas: { 'PUT /api/modelos-texto/m1': () => json({ ...MODELOS[0], arquivado: true }) },
    });
    setupModelos();
    await userEvent.click(await screen.findByRole('button', { name: 'Arquivar Retorno' }));
    await waitFor(() => expect(escritas(chamadas, 'modelos-texto')).toHaveLength(1));
    const put = escritas(chamadas, 'modelos-texto')[0]!;
    expect(put.metodo).toBe('PUT');
    expect(put.corpo).toEqual({
      nome: 'Retorno',
      corpo: 'Retorno em uma semana.',
      arquivado: true,
    });
    expect(screen.queryByRole('button', { name: /Excluir|Apagar/ })).toBeNull();
  });

  it('desarquivar envia arquivado falso', async () => {
    const chamadas = mock({
      rotas: { 'PUT /api/modelos-texto/m2': () => json({ ...MODELOS[1], arquivado: false }) },
    });
    setupModelos();
    await userEvent.click(await screen.findByLabelText('Mostrar arquivados'));
    await userEvent.click(await screen.findByRole('button', { name: 'Desarquivar Alta' }));
    await waitFor(() => expect(escritas(chamadas, 'modelos-texto')).toHaveLength(1));
    expect(escritas(chamadas, 'modelos-texto')[0]!.corpo).toEqual({
      nome: 'Alta',
      corpo: 'Alta concedida.',
      arquivado: false,
    });
  });
});

import { createServer } from 'node:http';
import { PORTA_COLETOR } from './config.ts';

// OPS-05: coletor dos e-mails do Worker local (E2E_EMAIL_CAPTURA_URL). Guarda as mensagens em
// memória; o teste lê por GET /emails?para=<endereço> e limpa com DELETE /emails.
// Só escuta em 127.0.0.1.

interface Mensagem {
  para: string;
  assunto: string;
  texto: string;
}
const mensagens: Mensagem[] = [];

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/saude') {
    res.writeHead(200).end('ok');
  } else if (url.pathname !== '/emails') {
    res.writeHead(404).end();
  } else if (req.method === 'POST') {
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => {
      mensagens.push(JSON.parse(Buffer.concat(partes).toString('utf8')) as Mensagem);
      res.writeHead(202).end();
    });
  } else if (req.method === 'GET') {
    const para = url.searchParams.get('para');
    const lista = para === null ? mensagens : mensagens.filter((m) => m.para === para);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(lista));
  } else if (req.method === 'DELETE') {
    mensagens.length = 0;
    res.writeHead(204).end();
  } else {
    res.writeHead(405).end();
  }
});

servidor.listen(PORTA_COLETOR, '127.0.0.1');

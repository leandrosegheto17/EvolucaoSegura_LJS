import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Postgres 18 em todo lugar: o Neon do projeto é 18, e o pg_dump precisa ser da mesma versão maior
// do servidor ou mais nova (um pg_dump 16 recusa um servidor 18). O teste só lê os arquivos.

const raiz = resolve(import.meta.dirname, '../../..');
const ler = (caminho: string): string => readFileSync(resolve(raiz, caminho), 'utf8');

interface Compose {
  services: Record<string, { image?: string; volumes?: string[] }>;
}

describe('versão do Postgres', () => {
  const compose = parse(ler('docker-compose.yml')) as Compose;
  const postgres = compose.services['postgres'];

  it('o docker-compose sobe o postgres:18', () => {
    expect(postgres?.image).toBe('postgres:18');
  });

  it('o volume do compose fica em /var/lib/postgresql (layout da imagem 18)', () => {
    const destinos = (postgres?.volumes ?? []).map((volume) => volume.split(':')[1]);
    expect(destinos).toContain('/var/lib/postgresql');
    expect(destinos).not.toContain('/var/lib/postgresql/data');
  });

  it.each(['.github/workflows/backup.yml', '.github/workflows/deploy.yml'])(
    '%s instala o cliente 18 do Postgres e nenhum outro',
    (workflow) => {
      const texto = ler(workflow);
      expect(texto).toContain('postgresql-client-18');
      expect(texto.match(/postgresql-client-\d+/g)).toEqual(['postgresql-client-18']);
    },
  );
});

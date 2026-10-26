import { useCallback, useEffect, useState } from 'react';

// Contagem regressiva em segundos, calculada pelo relógio (Date.now) a cada segundo: não acumula
// atraso quando a aba fica em segundo plano. Devolve os segundos restantes (0 = livre) e a função
// que (re)inicia a contagem.
export function useContagem(): [number, (segundos: number) => void] {
  const [fim, setFim] = useState<number | null>(null);
  const [, setTique] = useState(0);
  const restante = fim === null ? 0 : Math.max(0, Math.ceil((fim - Date.now()) / 1000));

  useEffect(() => {
    if (fim === null) return;
    const id = setInterval(() => {
      setTique((t) => t + 1);
      if (Date.now() >= fim) {
        clearInterval(id);
        setFim(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [fim]);

  const iniciar = useCallback((segundos: number) => setFim(Date.now() + segundos * 1000), []);
  return [restante, iniciar];
}

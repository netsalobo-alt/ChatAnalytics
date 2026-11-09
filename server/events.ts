// Eventos ao vivo para o navegador (Server-Sent Events): avisa as telas quando algo muda.

import type { Request, Response } from 'express';

export type LiveEvent = 'lead' | 'sync' | 'webhook' | 'backfill';

const clients = new Set<Response>();

export function liveStream(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // evita buffer em proxies
  });
  res.write('retry: 5000\n\n');
  clients.add(res);
  // Comentário periódico mantém a conexão aberta através do Traefik e de proxies.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function broadcast(type: LiveEvent, data: Record<string, unknown> = {}) {
  if (!clients.size) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

export const liveClients = () => clients.size;

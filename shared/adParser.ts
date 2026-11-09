// Lê a mensagem de anúncio que a integração WAHA → Chatwoot escreve na conversa:
//
//   📢 **ANÚNCIO DO FACEBOOK**
//   **Título:** Converse conosco
//   **Descrição:**
//   Somos a rede que mais aprova financiamentos...
//   **Link do Anúncio:** [Ver no Facebook](https://fb.me/xxxx)
//   **ID do Anúncio:** 120212345678901234
//   ---
//   💬 **MENSAGEM DO CLIENTE:**
//   Olá, quero realizar uma simulação

export interface AdInfo {
  platform: string; // Facebook, Instagram…
  id: string | null;
  title: string | null;
  description: string | null;
  link: string | null;
}

export interface ParsedAdMessage {
  ad: AdInfo;
  /** Só o que o cliente escreveu (sem o bloco do anúncio). */
  clientText: string;
}

const HEADER = /AN[ÚU]NCIO\s+DO\s+([A-ZÀ-Ú]+)/i;

const clean = (s: string | undefined | null) => {
  const v = (s ?? '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  return v || null;
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function isAdMessage(text: string | null | undefined): boolean {
  return Boolean(text && HEADER.test(text.slice(0, 120)));
}

export function parseAdMessage(text: string | null | undefined): ParsedAdMessage | null {
  if (!text || !isAdMessage(text)) return null;
  const platform = titleCase(HEADER.exec(text)![1]);

  // Separa o bloco do anúncio da mensagem do cliente.
  const split = text.split(/\n\s*-{3,}\s*\n/);
  const adBlock = split[0];
  let rest = split.slice(1).join('\n---\n');
  rest = rest.replace(/^[\s\S]*?MENSAGEM DO CLIENTE:?\**:?\s*/i, '');

  const field = (label: RegExp) => {
    const m = adBlock.match(label);
    return m ? m[1] : null;
  };

  const title = clean(field(/T[íi]tulo:?\**:?\s*([^\n]+)/i));
  // A descrição pode ocupar várias linhas, até o próximo rótulo em negrito.
  const description = clean(field(/Descri[çc][ãa]o:?\**:?\s*([\s\S]*?)(?=\n\s*\*\*|\n\s*(?:Link|ID)\b|$)/i));
  const linkRaw = field(/Link do An[úu]ncio:?\**:?\s*([^\n]+)/i);
  const link = linkRaw ? (linkRaw.match(/https?:\/\/[^\s)\]]+/) ?? [null])[0] : null;
  const id = (field(/ID do An[úu]ncio:?\**:?\s*([^\n]+)/i) ?? '').replace(/\D/g, '') || null;

  return {
    ad: { platform, id, title, description, link },
    clientText: rest.trim(),
  };
}

/** Rótulo padrão de um anúncio sem nome amigável. */
export function defaultAdLabel(ad: { id: string | null; description: string | null; platform?: string | null }): string {
  const desc = ad.description ? ad.description.slice(0, 46).trim() + (ad.description.length > 46 ? '…' : '') : null;
  const suffix = ad.id ? `#${ad.id.slice(-4)}` : '';
  if (desc) return `${desc} ${suffix}`.trim();
  return `Anúncio ${ad.platform ?? ''} ${suffix}`.replace(/\s+/g, ' ').trim();
}

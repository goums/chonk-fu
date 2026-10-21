// A tiny chat-completions client (Mistral Studio or OpenRouter, same JSON shape).
// In `npm run dev` the Vite proxy adds the key from .env; on a static build the player pastes a key.

export type Provider = 'mistral' | 'openrouter';
export interface Usage { prompt: number; completion: number; cached: number; cost: number }

const URLS: Record<Provider, { direct: string; proxy: string }> = {
  mistral: { direct: 'https://api.mistral.ai/v1/chat/completions', proxy: '/api/mistral/chat/completions' },
  openrouter: { direct: 'https://openrouter.ai/api/v1/chat/completions', proxy: '/api/openrouter/chat/completions' },
};

// USD per 1M tokens (Mistral list prices; OpenRouter reports the real cost)
const PRICES: [RegExp, { input: number; cached: number; output: number }][] = [
  [/large-4/, { input: 0.68, cached: 0.07, output: 2.09 }],
  [/large/, { input: 0.5, cached: 0.05, output: 1.5 }],
  [/medium-3-5|medium-3\.5/, { input: 1.5, cached: 0.15, output: 7.5 }],
  [/medium/, { input: 0.4, cached: 0.04, output: 2 }],
  [/small/, { input: 0.1, cached: 0.01, output: 0.3 }],
  [/ministral-14b/, { input: 0.2, cached: 0.02, output: 0.2 }],
  [/ministral-8b/, { input: 0.15, cached: 0.015, output: 0.15 }],
];
export function costOf(model: string, prompt: number, cached: number, completion: number) {
  const p = PRICES.find(([re]) => re.test(model))?.[1] ?? PRICES[0][1];
  return ((prompt - cached) * p.input + cached * p.cached + completion * p.output) / 1e6;
}

export interface ToolDef { type: 'function'; function: { name: string; description: string; parameters: object } }

/** one turn; returns the tool-call arguments (parsed) or the plain text answer */
export async function callTool(
  opts: { provider: Provider; model: string; apiKey?: string; temperature?: number; maxTokens?: number },
  system: string,
  user: string,
  tool: ToolDef,
  signal?: AbortSignal,
): Promise<{ args: Record<string, unknown> | null; text: string; usage: Usage; ms: number }> {
  const url = opts.apiKey ? URLS[opts.provider].direct : URLS[opts.provider].proxy;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    tools: [tool],
    tool_choice: opts.provider === 'mistral' ? 'any' : 'required',
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 400,
  };
  if (opts.provider === 'mistral') body.parallel_tool_calls = false;
  if (opts.provider === 'openrouter') body.usage = { include: true };
  const t0 = performance.now();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    if (r.status === 429 || r.status >= 500) {
      if (attempt >= 6) throw new Error(`HTTP ${r.status} after retries`);
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      continue;
    }
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    const msg = j.choices?.[0]?.message ?? {};
    const call = msg.tool_calls?.[0];
    let args: Record<string, unknown> | null = null;
    if (call) {
      try {
        args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
      } catch {
        args = null;
      }
    }
    const u = j.usage ?? {};
    const prompt = u.prompt_tokens ?? 0, completion = u.completion_tokens ?? 0;
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    const cost = typeof u.cost === 'number' ? u.cost : costOf(opts.model, prompt, cached, completion);
    const text = typeof msg.content === 'string' ? msg.content : '';
    return { args, text, usage: { prompt, completion, cached, cost }, ms: performance.now() - t0 };
  }
}

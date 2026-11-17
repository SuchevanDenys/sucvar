// app/lib/studio/aiModel.ts — modelul AI de imagine activ pe server (GET /api/ai/model).
// Studio afișează doar controalele pe care modelul le folosește:
//   • 'clip'        = SD 1.5 (adirik/interior-design, Stable Diffusion): prompt de 72 de tokeni, negativ, pași, CFG, intensitate;
//   • 'instruction' = FLUX Kontext: instrucțiune în limbaj natural; doar prompt suplimentar și seed.
import { apiFetch, readJson } from '@/app/lib/api-client';

export type PromptFormat = 'clip' | 'instruction';

export interface ActiveAiModel {
  provider: string;
  model: string;
  promptFormat: PromptFormat;
  /** Modelul folosit pentru „Editează o zonă” (ex. black-forest-labs/flux-fill-pro); implicit același model. */
  inpaintModel?: string;
  inpaintPromptFormat?: PromptFormat;
}

export const isPromptFormat = (v: unknown): v is PromptFormat => v === 'clip' || v === 'instruction';

/** Nu aruncă: dacă API-ul nu răspunde, Studio rămâne pe controalele CLIP (comportamentul istoric). */
export async function fetchActiveModel(): Promise<ActiveAiModel | null> {
  try {
    const res = await apiFetch('/api/ai/model');
    if (!res.ok) return null;
    const body = await readJson<Partial<ActiveAiModel>>(res);
    if (!isPromptFormat(body.promptFormat)) return null;
    return {
      provider: typeof body.provider === 'string' ? body.provider : '',
      model: typeof body.model === 'string' ? body.model : '',
      promptFormat: body.promptFormat,
      inpaintModel: typeof body.inpaintModel === 'string' ? body.inpaintModel : undefined,
      inpaintPromptFormat: isPromptFormat(body.inpaintPromptFormat) ? body.inpaintPromptFormat : undefined,
    };
  } catch {
    return null;
  }
}

const KNOWN_MODELS: Record<string, string> = {
  'black-forest-labs/flux-kontext-pro': 'FLUX Kontext Pro',
  'black-forest-labs/flux-kontext-max': 'FLUX Kontext Max',
  'black-forest-labs/flux-kontext-dev': 'FLUX Kontext Dev',
  'black-forest-labs/flux-fill-pro': 'FLUX Fill Pro',
  'black-forest-labs/flux-fill-dev': 'FLUX Fill Dev',
  'adirik/interior-design': 'Interior Design · SD 1.5',
  'stable-diffusion': 'Stable Diffusion',
  demo: 'Demo',
};

/** Nume lizibil: tabel cunoscut, altfel partea `name` din `owner/name` cu majuscule („my-model” → „My Model”). */
export function modelLabel(model: string): string {
  if (KNOWN_MODELS[model]) return KNOWN_MODELS[model];
  const name = model.split('/').pop() ?? model;
  return name.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

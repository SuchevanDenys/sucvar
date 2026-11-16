// app/lib/studio/aiConfig.ts
// Valori implicite și limite pentru parametrii de generare AI, folosite de controalele din Studio.
// Validarea autoritară a acelorași limite se face pe server (Sucvar.Domain/Ai, `AiLimits`);
// valorile de aici trebuie să rămână identice cu cele din backend.
import { AiSettings } from '@/app/types';

// Ce NU vrem să apară în imagine (scoate defectele tipice ale modelelor de difuzie)
export const DEFAULT_NEGATIVE_PROMPT =
  'lowres, watermark, text, blurry, deformed walls, broken perspective, distorted furniture, extra windows, ugly, oversaturated';

// Limitele acceptate pentru fiecare parametru (interfața și serverul le folosesc la fel)
export const AI_LIMITS = {
  inferenceSteps: { min: 10, max: 60, step: 1 },
  guidanceScale: { min: 1, max: 20, step: 0.5 },
  extraPromptMaxLength: 400,
  negativePromptMaxLength: 600,
  seedMax: 2_147_483_647,
  // Lungimea maximă a fotografiei trimise ca Data URL (~6 MB ca text base64)
  maxImageLength: 6_000_000,
};

// Limitele planurilor de abonament
export const PLAN_LIMITS = {
  starterMonthlyGenerations: 3, // proiecte / generări AI pe lună pentru planul gratuit
} as const;

// Setările cu care pornește Studio — identice cu valorile implicite ale compilatorului de prompt din backend
// (ArchitecturalPromptCompiler.SmartInferenceStepsDefault / SmartGuidanceDefault). CFG 9 = modelul respectă
// mai fidel instrucțiunile explicite fără să suprasatureze; 40 de pași = detalii de material curate.
export const DEFAULT_AI_SETTINGS: AiSettings = {
  extraPrompt: '',
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  inferenceSteps: 40,
  guidanceScale: 9,
  seed: null,
};

// Intensitatea transformării (img2img prompt_strength × 100). Cu structura păstrată, serverul o limitează la
// 62–80; zona 68–75 schimbă complet finisajele și mobilierul, dar ține pereții, ferestrele și unghiul camerei.
export const AI_STRENGTH = {
  recommended: 72,
  sweetSpot: { min: 68, max: 75 },
  preserveRange: { min: 62, max: 80 },
} as const;

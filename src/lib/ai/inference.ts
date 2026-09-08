// ── The on-device inference port ─────────────────────────────────────────────
//
// One interface, `TextInference`, names the three model calls the app needs:
// extract entities, classify topic, detect language. Everything above the port
// (mlSignals, the panel, the case briefing) depends ONLY on this interface and
// its output types, never on how the inference is produced.
//
// The default binding is the keyless, bundled-weights model in textAnalysis.ts —
// it needs no network and no key, so the app ships a working ML capability out
// of the box. The port is the extension point: a heavier backend (a quantised
// Transformers.js / ONNX model dropped into the app) can implement the same
// three methods and be swapped in without touching a single caller, and tests
// mock the port so the scoring layer stays deterministic and fully covered.

import {
  extractEntities, classifyText, detectLanguage,
  type MlEntity, type TextClassification, type LanguageGuess,
} from "./textAnalysis";

export type { MlEntity, MlEntityKind, TextClassification, TextCategory, CategoryScore, LanguageGuess } from "./textAnalysis";

export interface TextInference {
  extractEntities(text: string): MlEntity[];
  classify(text: string): TextClassification;
  detectLanguage(text: string): LanguageGuess;
}

/** The always-available, keyless model. No network, no key, no external weights. */
export const defaultTextInference: TextInference = {
  extractEntities,
  classify: classifyText,
  detectLanguage,
};

export interface TextInsights {
  /** Characters analysed (after trimming). */
  length: number;
  entities: MlEntity[];
  classification: TextClassification;
  language: LanguageGuess;
}

/**
 * Run every model over one block of text and return the combined insight bundle.
 * `inference` defaults to the bundled model but is injectable, so a caller can
 * pass a neural backend and a test can pass a mock. Pure with respect to the
 * inference it is given: same text + same backend → same insights.
 */
export function analyzeText(text: string, inference: TextInference = defaultTextInference): TextInsights {
  const trimmed = text.trim();
  return {
    length: trimmed.length,
    entities: inference.extractEntities(trimmed),
    classification: inference.classify(trimmed),
    language: inference.detectLanguage(trimmed),
  };
}

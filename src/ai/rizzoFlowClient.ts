// ============================================================
// src/ai/rizzoFlowClient.ts
// RizzoFlow HTTP client — Jev-compatible typed decisions.
//
// SETUP (one-time, do this before scanning):
//   git clone https://github.com/Rizzo-AI-Academy/rizzo-flow
//   cd rizzo-flow
//   uv sync --locked
//   uv run rizzo download          # downloads ~4.4 GB model + llama.cpp runtime
//   uv run rizzo serve             # starts at http://127.0.0.1:8017
//
// On Windows PowerShell:
//   uv run rizzo download
//   uv run rizzo serve --port 8017
//
// The server must be running before you start a scan.
// If it is NOT running, this client falls back gracefully to
// the algorithmic results computed by the existing evaluators.
// ============================================================

import http from 'http';
import pLimit from 'p-limit';
import { logger } from '../utils/logger.js';

// ─── Configuration ────────────────────────────────────────────

const RIZZO_HOST    = '127.0.0.1';
const RIZZO_PORT    = 8017;
const RIZZO_TIMEOUT = 60_000; // ms — 60s to allow inference on local GPU without false timeouts

// Mutex queue to serialize calls to the local LLM engine (prevents concurrent GPU contention)
const rizzoQueue = pLimit(1);

// ─── Wire format types (POST /v1/systemone) ───────────────────
// Matches the Jev-compatible wire format in compat.py.

/** A noul (yes/no) question. */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: {
    true?: string | null;
    false?: string | null;
  };
}

/**
 * A choice question.
 * `criteria` is a map of option-key → optional description (or null).
 * The winning key is returned in the response `.choice` field.
 */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  /** At least 2 entries. Keys are returned as-is in the response. */
  criteria: Record<string, string | null>;
}

/** A score question (ordered levels, low→high). */
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type RizzoQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

// ─── Response types ───────────────────────────────────────────

export interface NoulAnswer {
  type: 'noul';
  /** Probability that the answer is YES (0–1). > 0.5 means YES. */
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  /** The winning option key (as given in `criteria`). */
  choice: string;
  /** Map of option-key → probability. */
  probabilities: Record<string, number>;
  /** Peak-over-uniform confidence (0–1). */
  confidence: number;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
}

export type RizzoAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface RizzoSystemOneResponse {
  model: string;
  answers: Record<string, RizzoAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  /** Rizzo-specific timing extension — may be absent in future versions. */
  x_rizzo?: {
    timing: Record<string, number>;
    probability_status: string[];
    fingerprint?: string;
  };
}

// ─── Convenience helpers ──────────────────────────────────────

/**
 * Returns true if a noul answer's YES probability is > 0.5.
 */
export function noulIsYes(answer: RizzoAnswer): boolean {
  if (answer.type !== 'noul') throw new Error('Expected noul answer');
  return answer.noul > 0.5;
}

/**
 * Returns confidence of a noul answer (0 = coin-flip, 1 = certain).
 */
export function noulConfidence(answer: RizzoAnswer): number {
  if (answer.type !== 'noul') throw new Error('Expected noul answer');
  return Math.abs(answer.noul - 0.5) * 2;
}

// ─── Client ───────────────────────────────────────────────────

/**
 * Call RizzoFlow's /v1/systemone endpoint.
 *
 * @param state     - The unstructured context string sent to the LLM.
 * @param questions - A map of question-key → question definition.
 * @returns         The typed decisions, or null if the server is unavailable.
 */
export async function callRizzoFlow(
  state: string,
  questions: Record<string, RizzoQuestion>,
): Promise<RizzoSystemOneResponse | null> {
  const body = JSON.stringify({
    state,
    model: 'rizzo-latest',
    questions,
  });

  return rizzoQueue(() => {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host:    RIZZO_HOST,
          port:    RIZZO_PORT,
          path:    '/v1/systemone',
          method:  'POST',
          headers: {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: RIZZO_TIMEOUT,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk: Buffer) => (raw += chunk.toString()));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              // Log the body so validation errors from the server are visible
              logger.warn(`[RizzoFlow] Non-200 response: ${res.statusCode} — ${raw.slice(0, 400)}`);
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(raw) as RizzoSystemOneResponse);
            } catch (e) {
              logger.warn(`[RizzoFlow] Failed to parse response: ${(e as Error).message}`);
              resolve(null);
            }
          });
        },
      );

      req.on('timeout', () => {
        req.destroy();
        logger.warn('[RizzoFlow] Request timed out — falling back to algorithmic logic.');
        resolve(null);
      });

      req.on('error', (err) => {
        // ECONNREFUSED / ENOENT → server not running, fall back silently
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          logger.debug('[RizzoFlow] Server not running — using algorithmic fallback.');
        } else {
          logger.warn(`[RizzoFlow] Request error: ${err.message}`);
        }
        resolve(null);
      });

      req.write(body);
      req.end();
    });
  });
}

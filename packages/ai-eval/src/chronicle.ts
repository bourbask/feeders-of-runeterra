/**
 * The chronicle at N0 (02-mj-ia.md section 8.7, first bullet).
 *
 * « Sur une fixture […] et la chronique attendue enregistrée, vérifier la
 * validation (§ 5.6) et la présence des faits dorés (D7) — 0 appel réseau. »
 * That is what runs here, through `validateChronicle`, the server's own nine
 * checks. Nothing is re-implemented.
 *
 * ── WHAT N0 CAN AND CANNOT PROVE, SAID OUT LOUD ─────────────────────────────
 * With `previous: null` — there is no earlier version offline — C3 (statements
 * immutable at constant `fact_id`) has nothing to compare and cannot fail. C6
 * compares the document to a list of golden identifiers that lives in a
 * SEPARATE file, `chronicle/<id>.golden.json`, precisely so that the two
 * operands are two files a reviewer can see diverge; had they shared a file,
 * C6 would have been a list compared to itself and would have proven nothing
 * (ADR 0007, `docs/RECETTE.md` mode 5). That C6 bites is held by
 * `chronicle.test.ts` « retirer un fait doré du document fait tomber C6 »,
 * which removes one from a copy and expects the violation.
 *
 * The drift measurement of section 8.7 — regenerate five times and compare the
 * golden statements character by character — is N1 and is NOT delivered here:
 * it needs a real `structurer()` call, therefore a key. The sheet's perimeter
 * says N0 and nothing else.
 */

import { renderChronicle, renderChronicleParts, validateChronicle } from '@for/ai';
import type { SceneStateDto } from '@for/contracts';

import type { EvalFixture } from './fixtures.js';

export interface ChronicleVerdict {
  readonly ok: boolean;
  /** `C2`, `C4`, … with the identifiers at fault. */
  readonly violations: readonly { readonly check: string; readonly detail: string }[];
  readonly tokenCount: number;
  readonly renderedChars: number;
}

/**
 * Validate the shared chronicle against the scene of one case.
 *
 * The scene is a parameter because C9 — « la chronique contredit l'état de
 * scène sur un mort » — and the seams T4/T7 are defined against it. Running
 * the check on the scene of the case that holds a dead NPC is what gives C9
 * something to bite on; running it against `null` would leave it asleep.
 */
export function checkChronicle(
  fixture: EvalFixture,
  scene: SceneStateDto | null,
): ChronicleVerdict {
  const rendered = renderChronicle(renderChronicleParts(fixture.chronicle.doc, scene));
  const known = new Set<number>();
  for (let seq = 1; seq <= fixture.chronicle.knownEventSeqMax; seq += 1) known.add(seq);
  const result = validateChronicle({
    doc: fixture.chronicle.doc,
    previous: null,
    knownEventSeqs: known,
    targetEventSeq: fixture.chronicle.targetEventSeq,
    reservedChampions: fixture.reservedChampions,
    scene,
    goldenFactIds: fixture.chronicle.goldenFactIds,
    rendered,
  });
  return {
    ok: result.ok,
    violations: result.violations.map((one) => ({
      check: one.check,
      detail:
        one.offenders.length === 0 ? one.detail : `${one.detail} : ${one.offenders.join(', ')}`,
    })),
    tokenCount: result.tokenCount,
    renderedChars: rendered.length,
  };
}

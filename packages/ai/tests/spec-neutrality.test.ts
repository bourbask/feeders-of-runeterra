/**
 * The documentation test of 02-mj-ia.md section 0.7.
 *
 * From section 0.7 to the end of the document, nothing names a vendor and
 * nothing writes an API fact. Without a test, that neutrality is guarded by
 * nobody and is lost in three months of small edits — the specification
 * already demanded it and no task delivered it.
 *
 * ── THE TWO RULES HAVE DIFFERENT SCOPES, AND THAT IS THE POINT ──────────────
 * N1 (API facts) is exempt only in the adapter block. N2 (vendor names) is
 * exempt in a NAMED, CLOSED list of sections: a `providerId` has to be written
 * somewhere, and the `adapters/<id>.ts` paths have to be readable in the tree.
 *
 * ── WHY §0.7 IS EXEMPT FROM N1 TOO ──────────────────────────────────────────
 * Section 0.7 used to write N1's scope as "partout sauf §0.3 à §0.6". Applied
 * to the letter, N1 was RED BY CONSTRUCTION: the rule's own table, which lives
 * in §0.7, necessarily spells the ten forbidden patterns — it IS the rule.
 * Measured: that table's line is the ONLY one outside §0.3–§0.6 that matches
 * N1. The section's closing paragraph already made the argument ("un test
 * rouge par construction est un test qu'on désactive dans la semaine"), so the
 * SPECIFICATION's table was corrected in this pull request rather than this
 * file bending around it, and the two now say the same thing. The exemption is
 * nominative and closed, like N2's.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SPEC = fileURLToPath(new URL('../../../docs/design/02-mj-ia.md', import.meta.url));
const LINES = readFileSync(SPEC, 'utf8').split('\n');

/** N1 — API facts. Section 0.7's list, typed out. */
const N1 =
  /claude-|gpt-|stop_reason|cache_control|output_config|max_tokens|@anthropic-ai|openrouter\.ai|\/api\/chat|chat\/completions/i;

/** N2 — vendor names. Section 0.7's list, typed out. */
const N2 = /anthropic|openai|ollama|openrouter|groq|together/i;

/** The adapter block, and §0.7's own table, which has to spell the patterns. */
const N1_EXEMPT = new Set(['0.3', '0.4', '0.5', '0.6', '0.7']);
/** Named and closed: the port's own vocabulary, the adapters, the rule, the tree, the arbitrations. */
const N2_EXEMPT = new Set(['0.1', '0.3', '0.4', '0.5', '0.6', '0.7', '10', '11']);

/** Which `##` section each line belongs to, by its leading number. */
function sectionOf(index: number): string {
  for (let at = index; at >= 0; at -= 1) {
    const line = LINES[at] ?? '';
    const heading = /^##\s+([0-9]+(?:\.[0-9]+)?)\.?\s/.exec(line);
    if (heading?.[1] !== undefined) return heading[1];
  }
  return '';
}

interface Hit {
  readonly line: number;
  readonly section: string;
  readonly text: string;
}

function hits(pattern: RegExp, exempt: ReadonlySet<string>): Hit[] {
  const found: Hit[] = [];
  for (const [index, line] of LINES.entries()) {
    const section = sectionOf(index);
    if (exempt.has(section)) continue;
    if (!pattern.test(line)) continue;
    found.push({ line: index + 1, section, text: line.trim().slice(0, 120) });
  }
  return found;
}

describe('la lecture du document', () => {
  it('voit bien la spec, et ses sections', () => {
    expect(LINES.length).toBeGreaterThan(2000);
    expect(sectionOf(LINES.findIndex((line) => line.startsWith('## 0.3 ')))).toBe('0.3');
    expect(sectionOf(LINES.findIndex((line) => line.startsWith('## 10. ')))).toBe('10');
  });

  /**
   * The scanner must be able to SEE a forbidden pattern, or the two rules
   * below are green because nothing matches anything. The adapter block is
   * where those patterns legitimately live, so that is where the proof is.
   */
  it('et voit les motifs interdits là où ils ont le droit d’être', () => {
    const inAdapters = LINES.filter((line, index) => sectionOf(index) === '0.3' && N1.test(line));
    expect(inAdapters.length).toBeGreaterThan(5);
  });
});

describe('N1 — aucun fait d’API hors du bloc des adaptateurs', () => {
  it('ne trouve rien', () => {
    expect(hits(N1, N1_EXEMPT)).toStrictEqual([]);
  });
});

describe('N2 — aucun nom de fournisseur hors des exemptions nominatives', () => {
  it('ne trouve rien', () => {
    expect(hits(N2, N2_EXEMPT)).toStrictEqual([]);
  });
});

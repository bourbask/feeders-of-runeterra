/**
 * THE CROSS-CHECK BETWEEN THE SPECIFICATION AND THE CODE.
 *
 * 03-donnees.md section 3.4 is the catalogue of record: 71 event types, in a
 * stated order, one markdown row each. `GAME_EVENT_TYPES` in `@for/engine` is
 * its transcription, and `zGameEvent` in this package is its validation. Three
 * lists, one truth — so this file reads the markdown and compares all three.
 *
 * WHY READ THE MARKDOWN AT ALL. Because the failure this guards against is a
 * type added to the code and never written down, or written down and never
 * implemented. Neither shows up in a compiler. The spec says the CI must fail
 * when `GameEventSchema` holds a `type` absent from that file, and naming this
 * test is how the spec says to do it.
 *
 * It fails in every direction on purpose: remove a markdown row, remove a
 * schema variant, remove a line from the engine constant, or merely reorder
 * one of the three, and the run goes red.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAME_EVENT_TYPES } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { gameEventTypesOfSchema } from '../src/events/index.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CATALOGUE = join(REPO_ROOT, 'docs', 'design', '03-donnees.md');

/** The catalogue announces its own size. Keep the number here, not a variable. */
const EXPECTED_COUNT = 71;

const SECTION_START = '### 3.4 Catalogue exhaustif des types';
const SECTION_END = '### 3.5 ';

/** `| `campaign.created` | system | { … } |` -> `campaign.created`. */
const TYPE_ROW = /^`([a-z_]+\.[a-z_]+)`$/;

function readCatalogueSection(): string {
  const markdown = readFileSync(CATALOGUE, 'utf8');
  const start = markdown.indexOf(SECTION_START);
  const end = markdown.indexOf(SECTION_END, start);
  expect(start, `section « ${SECTION_START} » introuvable dans ${CATALOGUE}`).toBeGreaterThan(-1);
  expect(end, `section « ${SECTION_END} » introuvable dans ${CATALOGUE}`).toBeGreaterThan(start);
  return markdown.slice(start, end);
}

/**
 * The first cell of every table row that names an event type.
 *
 * Splitting on `|` is safe for the FIRST cell only: payload cells hold escaped
 * pipes (`'left'\|'kicked'`), and nothing before the first cell does.
 */
function eventTypesOfMarkdown(): readonly string[] {
  return readCatalogueSection()
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => (line.split('|')[1] ?? '').trim())
    .map((cell) => TYPE_ROW.exec(cell)?.[1])
    .filter((type): type is string => type !== undefined);
}

describe('catalogue des 71 types d’événements', () => {
  const fromMarkdown = eventTypesOfMarkdown();
  const fromEngine = [...GAME_EVENT_TYPES];
  const fromSchema = gameEventTypesOfSchema();

  it('le markdown de 03-donnees.md §3.4 en déclare exactement 71, sans doublon', () => {
    expect(fromMarkdown).toHaveLength(EXPECTED_COUNT);
    expect(new Set(fromMarkdown).size).toBe(EXPECTED_COUNT);
  });

  it('GAME_EVENT_TYPES du moteur est la transcription du markdown, même ordre', () => {
    expect(fromEngine).toStrictEqual(fromMarkdown);
  });

  it('zGameEvent porte une variante par ligne du markdown, même ordre', () => {
    expect(fromSchema).toStrictEqual(fromMarkdown);
  });

  it('le total annoncé par le markdown est celui qu’on y compte', () => {
    expect(readCatalogueSection()).toContain(`Total : **${String(EXPECTED_COUNT)} types**`);
  });

  it('aucun type n’est déclaré deux fois dans le schéma', () => {
    expect(new Set(fromSchema).size).toBe(fromSchema.length);
  });
});

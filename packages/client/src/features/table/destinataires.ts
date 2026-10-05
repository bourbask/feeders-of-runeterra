import type { TableStateDto } from '@for/contracts';

import type { PresenceMember } from '../../ws/store.js';

/**
 * WHO READS THIS BLOCK — names where the wire has them, and a MECHANICAL
 * IDENTIFIER for the group in every case.
 *
 * THE LIMIT, SAID FIRST BECAUSE EVERYTHING HERE FOLLOWS FROM IT. `s2c.presence`
 * carries `playerId` and `characterId` and NO display name
 * (`contracts/src/ws/s2c.ts`). What this file does is JOIN, never mint: a
 * recipient's player id is looked up in presence, its character id in the
 * snapshot the server sent, and `displayName` is read off that character. A
 * recipient who is not present, or who has no character, HAS NO NAME TODAY, and
 * the screen says so rather than writing an id in a sentence meant to be read
 * aloud. Widening the contract is the server's call (invariant 3), and the
 * group's own identity is issue 116.
 *
 * WHY THERE IS A KEY AT ALL, and it is the point of this file. A group that is
 * named « vous 2 — Kevin et Théo » today and « vous 3 — … » tomorrow is two
 * groups to the reader and one to the engine, or the reverse, and nothing on
 * screen says which. So every group carries a KEY, derived from its membership
 * and from nothing else: the same people always give the same key, two
 * different sets never give the same one, and the key is written beside the
 * names. It is therefore stable for as long as the group IS that group — and
 * that is precisely its limit: a departure or an arrival makes a NEW key,
 * because membership is all the client has. A key that survives a membership
 * change has to be minted by the server and carried on the envelope; that is
 * issue 116, it is named on screen, and this file does not pretend otherwise.
 *
 * PURE, AND THAT IS WHY IT IS NOT IN A COMPONENT: `destinataires.test.ts`
 * enumerates the cases — nobody named, some named, order reversed, membership
 * changed — without rendering anything.
 */

export interface Groupe {
  /**
   * The mechanical identifier, `g-xxxxxx`. Derived from the membership, so it
   * is the same on every block of the same group and in the composer.
   */
  readonly cle: string;
  /** The full membership behind `cle`, sorted. What the key is a digest OF. */
  readonly membres: readonly string[];
  /** Display names found on the wire, in the membership's sorted order. */
  readonly noms: readonly string[];
  /** Recipients for whom the protocol carries no name. Said out loud, not hidden. */
  readonly sansNom: number;
}

/**
 * FNV-1a, 32 bits, written out rather than imported: règle 6 forbids a new
 * dependency, and a digest used for a six-character label needs nothing more.
 * It is NOT a security primitive and nothing here treats it as one.
 */
function digest(texte: string): string {
  let hache = 0x81_1c_9d_c5;
  for (let index = 0; index < texte.length; index += 1) {
    hache ^= texte.charCodeAt(index);
    hache = Math.imul(hache, 0x01_00_01_93) >>> 0;
  }
  return hache.toString(36).padStart(6, '0').slice(-6);
}

/**
 * The key of a membership. SORTED FIRST, so the order the server happened to
 * list the recipients in cannot produce two keys for one group; deduplicated,
 * so a repeated id cannot either.
 */
export function cleDeGroupe(membres: readonly string[]): string {
  const tries = [...new Set(membres)].sort();
  return `g-${digest(tries.join('\u001f'))}`;
}

/**
 * The display name of a CHARACTER, read off the snapshot. `null` when there is
 * no character, or when the snapshot has not arrived yet.
 *
 * THE SNAPSHOT NAMES EVERYONE, and that is not an assumption:
 * `contracts/src/dto/table-state.ts` says it in full letters — « `characters`
 * is NOT filtered: every player at the table sees everyone's sheet ». So this
 * join works for every character at the table, not only for mine.
 *
 * Held by `destinataires.test.ts` « nomme un personnage de l'instantané, et
 * rend null quand il n'y est pas ».
 */
export function nomDuPersonnage(
  characterId: string | null,
  table: TableStateDto | null,
): string | null {
  if (characterId === null) return null;
  const personnage = table?.characters.find((candidat) => candidat.id === characterId) ?? null;
  return personnage?.displayName ?? null;
}

/**
 * The player behind a character, as presence joins the two. `null` when nobody
 * present holds that character.
 *
 * THE OTHER DIRECTION OF THE SAME JOIN, and the feed needs it: a journal line
 * names its speaker by CHARACTER (`ws/journal.ts`), while an envelope names its
 * recipients by PLAYER (ADR 0008). Deciding whether the person who just spoke
 * is one of the people the previous block was addressed to is therefore a join,
 * and it is this one. `fil.ts` is its only caller today.
 *
 * Held by `destinataires.test.ts` « retrouve le joueur derrière un personnage,
 * et personne quand la présence ne le porte pas ».
 */
export function joueurDuPersonnage(
  characterId: string | null,
  presence: readonly PresenceMember[],
): string | null {
  if (characterId === null) return null;
  const membre = presence.find((present) => present.characterId === characterId);
  return membre?.playerId ?? null;
}

/** The display name of a player, or `null` when the wire carries none. */
function nomDuJoueur(
  playerId: string,
  presence: readonly PresenceMember[],
  table: TableStateDto | null,
): string | null {
  const membre = presence.find((present) => present.playerId === playerId);
  return nomDuPersonnage(membre?.characterId ?? null, table);
}

/** The group a list of recipients makes: its key, its names, and what is missing. */
export function groupeDe(
  membres: readonly string[],
  presence: readonly PresenceMember[],
  table: TableStateDto | null,
): Groupe {
  const tries = [...new Set(membres)].sort();
  const noms: string[] = [];
  let sansNom = 0;
  for (const playerId of tries) {
    const nom = nomDuJoueur(playerId, presence, table);
    if (nom === null) sansNom += 1;
    else noms.push(nom);
  }
  return { cle: cleDeGroupe(tries), membres: tries, noms, sansNom };
}

/**
 * « Kevin et Théo », « Kevin, Théo et Ana ». The last separator is « et »
 * because this sentence is read aloud at a table, not parsed.
 */
export function enumerer(noms: readonly string[]): string {
  if (noms.length === 0) return '';
  if (noms.length === 1) return noms[0] ?? '';
  return `${noms.slice(0, -1).join(', ')} et ${noms.at(-1) ?? ''}`;
}

/**
 * What a group block writes: « vous 2 — Kevin et Théo ». The COUNT comes from
 * the membership and the NAMES from what was found, so a group of three with
 * one unnamed reads « vous 3 — Kevin et Théo », never « vous 2 ». The sentence
 * that says one is missing is a separate, visible line — see `Journal.tsx`.
 */
export function phraseDuGroupe(groupe: Groupe): string {
  const combien = `vous ${String(groupe.membres.length)}`;
  return groupe.noms.length === 0 ? combien : `${combien} — ${enumerer(groupe.noms)}`;
}

/** « il manque le nom de 2 d'entre eux », or `null` when nothing is missing. */
export function phraseDesManquants(groupe: Groupe): string | null {
  if (groupe.sansNom === 0) return null;
  return groupe.sansNom === 1
    ? 'le nom d’un destinataire manque : le protocole n’en porte pas encore (issue 116)'
    : `le nom de ${String(groupe.sansNom)} destinataires manque : le protocole n’en porte pas encore (issue 116)`;
}

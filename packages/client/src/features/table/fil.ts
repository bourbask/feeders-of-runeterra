import type { JournalLine } from '../../ws/journal.js';
import { isReadable } from '../../ws/journal.js';
import type { PresenceMember } from '../../ws/store.js';
import { avertissementDeclassification } from './Destinataire.js';
import { cleDeGroupe, joueurDuPersonnage } from './destinataires.js';
import { porteeVue } from './portee.js';

/**
 * WHAT THE FEED SHOWS AROUND EACH BLOCK — the four decisions of 5 October, as
 * ONE pure function over the journal.
 *
 * It is a function and not four `useMemo`s inside `Journal.tsx` for one reason:
 * each of these rules is about a block's NEIGHBOURS, and a rule about
 * neighbours written inside a `map` is a rule that is right until someone
 * inserts a filter above it. `fil.test.ts` runs the four over fixtures of at
 * least two blocks, in a non-natural order, and asserts the exact array.
 *
 * 1. THE BAND IS WRITTEN ONCE PER RUN (correction 2). « On écrit l'étiquette au
 *    PREMIER bloc d'une suite, et on ne la réécrit QUE lorsque la portée
 *    change. » The run key is the scope AND the group, not the scope alone: two
 *    different groups in a row are two runs, otherwise the second group would
 *    inherit the first one's band and the reader would believe he is still
 *    writing to Kevin and Théo. That is the continuity the mechanical key
 *    exists for (`destinataires.ts`).
 *
 * 2. THE SPLIT IS AN EVENT, NOT A SIDE EFFECT (correction 9). The rails appear
 *    the moment a public run gives way to a restricted one; without a line
 *    saying so, « les rails apparaissent sans explication ».
 *
 * 3. A PROMOTED BLOCK IS THE PLAYER'S DOING, NOT THE SYSTEM'S (correction 10),
 *    and the scope predicate is NOT retyped here: it is
 *    `avertissementDeclassification`, the very function §7.2 uses to warn
 *    BEFORE the send. The warning before and the mark after are the same rule
 *    read twice, so they cannot drift — if one day group → public stops being a
 *    declassification, both change together or neither does.
 *
 *    BUT THE SCOPE PREDICATE IS ONLY HALF THE RULE, AND THE MISSING HALF IS WHO
 *    SPEAKS. §7.2 warns ME about what I am about to send: the actor is me, by
 *    construction, so the scopes alone decide. In the feed the actor is ANYONE,
 *    so the same two scopes say nothing: « le conteur me parle en privé, un
 *    AUTRE joueur parle ensuite en public » has exactly the shape of a
 *    declassification and is none — that player received nothing. Writing
 *    « il l'a rendu public, personne d'autre » under his name would be a NAMED
 *    ACCUSATION, false, in front of the whole table. So a block is promoted
 *    only when THE SPEAKER IS ONE OF THE RECIPIENTS of the restricted block he
 *    answers, and that is a join: a line names its speaker by CHARACTER, an
 *    envelope names its recipients by PLAYER, and `destinataires.ts` joins the
 *    two through presence. Without presence, nobody is accused — the mark is
 *    an accusation, and the silent answer to « I cannot tell » is silence.
 *    `fil.test.ts` holds it with TWO ACTORS; one actor cannot see this at all.
 *
 * 4. THE DICE ARE SET ASIDE (correction 11). « Pourquoi ? » no longer sits on
 *    the turn that rolled: it is attached to the FIRST READABLE BLOCK THAT
 *    COMES AFTER the roll, whatever turn that block belongs to. A roll with
 *    nothing after it yet carries NO button at all — that is the whole point of
 *    the decision, the mechanics wait for the next scene. Exactly one button
 *    per rolled turn, still.
 */

export interface BlocDuFil {
  readonly ligne: JournalLine;
  /** First block of its run: it alone wears the band (correction 2). */
  readonly ouvreUneSuite: boolean;
  /** « le groupe s'est séparé », rendered ABOVE this block (correction 9). */
  readonly rupture: boolean;
  /**
   * THIS SPEAKER answered in public what he himself had been told in private
   * (correction 10). False for anyone who was not a recipient of the block he
   * answers, and false when presence cannot tell.
   */
  readonly promu: boolean;
  /** The turn whose « Pourquoi ? » this block carries, or `null` (correction 11). */
  readonly preuveDuTour: string | null;
}

/** What makes two consecutive blocks « the same run »: the scope AND the group. */
function cleDeSuite(ligne: JournalLine): string {
  const membres = ligne.recipients ?? [];
  return membres.length === 0 ? ligne.scope : `${ligne.scope}:${cleDeGroupe(membres)}`;
}

/**
 * For each turn that rolled, the delivery number of its LAST roll.
 *
 * READ OVER ALL THE LINES, mechanical ones included — a `roll.action_resolved`
 * carries no prose, so it is invisible to the reader and would be invisible to
 * this scan too if it ran after the filter. The LAST roll and not the first: a
 * turn that rolls, narrates, then rolls again must not hand its proof to a
 * block written between the two.
 */
function dernierJetParTour(lignes: readonly JournalLine[]): ReadonlyMap<string, number> {
  const derniers = new Map<string, number>();
  for (const ligne of lignes) {
    if (!ligne.hasRoll || ligne.correlationId === null) continue;
    const connu = derniers.get(ligne.correlationId);
    if (connu === undefined || ligne.deliverySeq > connu) {
      derniers.set(ligne.correlationId, ligne.deliverySeq);
    }
  }
  return derniers;
}

/**
 * Did the person speaking receive the restricted block just above?
 *
 * THE JOIN, AND WHAT IT ANSWERS WITH WHEN IT CANNOT TELL. `ligne.speaker` is a
 * character id (`ws/journal.ts`), `precedente.recipients` are player ids (ADR
 * 0008), and presence is the only thing that holds both. A missing speaker, an
 * absent presence, a recipient list that is empty: each of them means « I do
 * not know who this is », and the answer to that is FALSE — no mark, no
 * sentence, no name. The mark accuses; an accusation is not a default.
 */
function leLocuteurAvaitRecu(
  ligne: JournalLine,
  precedente: JournalLine,
  presence: readonly PresenceMember[],
): boolean {
  const destinataires = precedente.recipients ?? [];
  if (destinataires.length === 0) return false;
  const joueur = joueurDuPersonnage(ligne.speaker, presence);
  if (joueur === null) return false;
  return destinataires.includes(joueur);
}

/**
 * `presence` is NOT optional and has no default, on purpose: a default would
 * make every existing call site compile unchanged and silently fall back to
 * « nobody is ever promoted », which is the failure this parameter exists to
 * prevent. A caller that has no presence passes `[]` and says so.
 */
export function composerLeFil(
  toutes: readonly JournalLine[],
  presence: readonly PresenceMember[],
): readonly BlocDuFil[] {
  const lisibles = toutes.filter(isReadable);
  const jets = dernierJetParTour(toutes);

  // Correction 11: each rolled turn waits for the first readable block that
  // comes STRICTLY after its last roll. Served once, then struck off.
  const enAttente = new Map<string, number>(jets);
  const preuves = new Map<string, string>();
  for (const ligne of lisibles) {
    for (const [tour, apres] of enAttente) {
      if (ligne.deliverySeq <= apres) continue;
      const cle = `${String(ligne.seq)}:${String(ligne.deliverySeq)}`;
      // A block already carrying a proof does not take a second one: two
      // « Pourquoi ? » side by side name two turns and look like one.
      if ([...preuves.values()].includes(cle)) continue;
      preuves.set(tour, cle);
      enAttente.delete(tour);
    }
  }
  const porteurs = new Map<string, string>();
  for (const [tour, cle] of preuves) porteurs.set(cle, tour);

  const blocs: BlocDuFil[] = [];
  let precedente: JournalLine | null = null;

  for (const ligne of lisibles) {
    const vue = porteeVue(ligne.scope);
    const suitePrecedente = precedente === null ? null : cleDeSuite(precedente);
    const cle = `${String(ligne.seq)}:${String(ligne.deliverySeq)}`;

    blocs.push({
      ligne,
      ouvreUneSuite: suitePrecedente !== cleDeSuite(ligne),
      rupture: vue.marque && precedente !== null && precedente.scope === 'table',
      promu:
        ligne.kind === 'joueur' &&
        precedente !== null &&
        avertissementDeclassification(precedente.scope, ligne.scope) !== null &&
        leLocuteurAvaitRecu(ligne, precedente, presence),
      preuveDuTour: porteurs.get(cle) ?? null,
    });

    precedente = ligne;
  }

  return blocs;
}

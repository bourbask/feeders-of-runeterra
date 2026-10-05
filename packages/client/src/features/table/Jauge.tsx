import type { GaugeId, GaugeSet } from '@for/engine';
import { GAUGE_MAX } from '@for/engine';
import type { ReactNode } from 'react';

/**
 * The three gauges, as ONE component (05-interface.md §6).
 *
 * WHY ONE COMPONENT AND NOT THREE. §6.2: « le bloc des trois jauges est un
 * composant unique, pas trois composants identiques empilés, précisément pour
 * que "laquelle a changé" soit une question d'emplacement et non de couleur. »
 * The order is `JAUGES` and it never varies, so the second row is the soul
 * whether or not anything happened to it. THE POSITION IS THE INFORMATION.
 *
 * WHAT A PLAYER READS WITHOUT A SINGLE COLOUR, which is the acceptance
 * criterion of §6 and not a preference:
 *
 *   - the NAME, in full letters, never abbreviated to a pictogram — « âme » is
 *     the only thing that stops a pale bar being read as an empty vigour bar ;
 *   - a GLYPH, one per gauge, the three distinct ;
 *   - a FORM: vigour and soul are a tube, supplies are pips (§6.1) — one does
 *     not add supplies up in one's head ;
 *   - the VALUE, written out. §2.3: « Jamais l'aplat seul — un aplat sans
 *     valeur écrite est une forme décorative. »
 *
 * Held by `Jauge.test.tsx`, which strips every `class` and `style` off the
 * rendered tree and still asks which gauge is which.
 *
 * THE MOMENTUM IS NOT HERE, and cannot be: `JAUGES` is compared to the
 * engine's `GAUGES` at runtime, and the engine's momentum is a bound set, not
 * a gauge (`types/gauges.ts`). It renders as `Elan.tsx`, a badge.
 */

/**
 * The three, in the order of 04 §4.3 « vigueur / âme / vivres ».
 *
 * NOT A COPY OF THE ENGINE'S LIST — a copy would let the engine shrink to two
 * gauges without a word (`satisfies` is covariant, ADR 0007). The ORDER is this
 * file's decision, the MEMBERSHIP is the engine's, and `Jauge.test.tsx`
 * compares the two sets member by member.
 */
export const JAUGES = ['vigueur', 'ame', 'vivres'] as const satisfies readonly GaugeId[];

export type EtatJauge = 'pret' | 'chargement' | 'erreur' | 'desactive';

interface Vue {
  readonly nom: string;
  readonly glyphe: string;
  readonly forme: 'tube' | 'pastilles';
}

/**
 * The name, the glyph and the form of each gauge. Three channels, all of them
 * readable in black and white — `--vigueur-aplat` and friends only repeat what
 * is already written here.
 */
const VUES: Readonly<Record<GaugeId, Vue>> = {
  vigueur: { nom: 'Vigueur', glyphe: '▰', forme: 'tube' },
  ame: { nom: 'Âme', glyphe: '◆', forme: 'tube' },
  vivres: { nom: 'Vivres', glyphe: '◍', forme: 'pastilles' },
};

/** The value, written out. `—` when there is nothing yet (§9, « vide »). */
function valeurEcrite(valeur: number | null, forme: Vue['forme']): string {
  if (valeur === null) return '—';
  // Pips are counted, not compared to a maximum: one pip is one supply.
  return forme === 'pastilles' ? String(valeur) : `${String(valeur)} / ${String(GAUGE_MAX)}`;
}

/** The pips of §6.1, as characters: the level is IN the dom, not only in a fill. */
function pastilles(valeur: number): string {
  return '●'.repeat(valeur) + '○'.repeat(Math.max(0, GAUGE_MAX - valeur));
}

function Jauge(props: {
  readonly id: GaugeId;
  readonly rang: number;
  readonly valeur: number | null;
  readonly modifiee: boolean;
  readonly etat: EtatJauge;
}): ReactNode {
  const vue = VUES[props.id];
  const part = props.valeur === null ? 0 : Math.round((props.valeur / GAUGE_MAX) * 100);

  return (
    <li
      className="fr-jauge"
      data-jauge={props.id}
      data-forme={vue.forme}
      data-rang={String(props.rang)}
      {...(props.modifiee ? { 'data-modifiee': 'true' } : {})}
    >
      <span className="fr-jauge__glyphe" aria-hidden="true">
        {vue.glyphe}
      </span>
      <span className="fr-jauge__nom">{vue.nom}</span>
      {vue.forme === 'tube' ? (
        <span className="fr-jauge__tube" aria-hidden="true">
          <span className="fr-jauge__plein" style={{ width: `${String(part)}%` }} />
        </span>
      ) : (
        <span className="fr-jauge__pastilles" aria-hidden="true">
          {pastilles(props.valeur ?? 0)}
        </span>
      )}
      <span className="fr-jauge__valeur">{valeurEcrite(props.valeur, vue.forme)}</span>
      {/* The position already says which one moved. This says it a second time,
          in letters, because a position is only readable by someone who knows
          the order by heart — and nobody does on their first evening. */}
      {props.modifiee ? <span className="fr-jauge__marque">modifiée ce tour</span> : null}
      {props.etat === 'erreur' ? (
        <span className="fr-jauge__erreur">valeur peut-être en retard</span>
      ) : null}
    </li>
  );
}

export function Jauges(props: {
  readonly valeurs: GaugeSet | null;
  /** The gauge a turn has just touched (§6.2, the fourth state). */
  readonly modifiee?: GaugeId | null;
  readonly etat?: EtatJauge;
  /** Horizontal, in the header: the phone layout of §4.4. */
  readonly disposition?: 'verticale' | 'horizontale';
}): ReactNode {
  const etat = props.etat ?? 'pret';
  const modifiee = props.modifiee ?? null;

  return (
    <ol className="fr-jauges" data-etat={etat} data-disposition={props.disposition ?? 'verticale'}>
      {JAUGES.map((id, index) => (
        <Jauge
          key={id}
          id={id}
          rang={index + 1}
          valeur={props.valeurs === null ? null : props.valeurs[id]}
          modifiee={modifiee === id}
          etat={etat}
        />
      ))}
    </ol>
  );
}

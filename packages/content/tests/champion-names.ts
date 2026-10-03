/**
 * The champion-name normalisation of 02-mj-ia.md section 8.4 — the one
 * `no_reserved_champion` runs on, accents folded, dashes and underscores
 * collapsed to spaces.
 *
 * NOT A TEST FILE, on purpose. It lived inside `game-content.test.ts` until
 * S-03 needed the SAME normalisation over `content/nodes`, `content/figures`
 * and the four other scenario families: importing one `*.test.ts` from another
 * makes vitest collect its suites twice, and recopying the four lines would be
 * exactly the "recopie non comparée" ADR 0007 exists to refuse. One owner, two
 * readers — `game-content.test.ts` « n’écrit le nom d’aucun autre champion de
 * l’annuaire dans une fiche » and `freljord-content.test.ts` « aucun texte de
 * scénario ne cite un champion de l’annuaire ».
 */

export function normaliseChampionName(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replaceAll(/[\s‐-―_-]+/gu, ' ')
    .trim();
}

/**
 * Replie les apostrophes typographiques sur l'apostrophe droite.
 *
 * SÉPARÉ DE `normaliseChampionName`, ET C'EST UNE DIVERGENCE DÉLIBÉRÉE. La
 * normalisation de 02-mj-ia.md section 8.4 plie les accents et les tirets,
 * mais PAS les apostrophes : mesuré, « L’Archère de Givre » écrit avec une
 * apostrophe typographique ne correspond pas à « L'Archère de Givre » écrit
 * avec une droite, et passe donc à travers `no_reserved_champion`. Le trou est
 * signalé dans la PR de S-03 plutôt que refermé en douce — la section 8.4 est
 * une spécification, et `game-content.test.ts` continue de la suivre à la
 * lettre.
 *
 * Les contrôles de S-03 sur `content/` appliquent ce repli EN PLUS, ce qui les
 * rend strictement plus attrapants. Tenu par `freljord-content.test.ts`
 * « une apostrophe typographique ne fait pas passer une faction interdite ».
 */
export const foldApostrophes = (value: string): string => value.replaceAll(/[‘’ʼ`]/gu, "'");

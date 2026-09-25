/**
 * The closed lists of 02-mj-ia.md section 8.4, and nothing else.
 *
 * They are CLOSED, and that is the property that makes the hard assertions
 * usable as a production post-filter: a closed list has no morphological
 * ambiguity, and the `<corrections>` retry can quote the exact offending word.
 *
 * ── ONE LIST IS SEEN TWICE ──────────────────────────────────────────────────
 * `BANNED_STYLE_LEXICON` is also what the system prompt's blacklist names. A
 * term the filter rejects and the prompt never mentions is a refusal the model
 * was never warned about, and one refusal is one engine fallback a player
 * sees. `tests/prompt-size.test.ts` compares the two and names the known gap.
 */

/**
 * `no_rules_lexicon`. Section 8.4 qualifies `âme` with « en contexte de
 * jauge », which is NOT mechanically expressible — see the assertion's own
 * comment, and the pull request, where it is reported rather than worked
 * around.
 */
export const RULES_LEXICON = [
  'vigueur',
  'âme',
  'vivres',
  'souffle',
  'serment',
  'horloge',
  'jet',
  'case',
  'cran',
  'rang',
  'mouvement',
  'joueur',
  'maître du jeu',
  'MJ',
  'PNJ',
  'PJ',
  'oracle',
  'piste',
  'progression',
] as const;

/**
 * The two terms of `RULES_LEXICON` that MUST keep their accents.
 *
 * Section 8.4 prescribes an accent-insensitive search. Applied to these two it
 * matches `de` and `des`, so the hard assertion would fail on every French
 * sentence and the production post-filter would fall back to the engine on
 * every turn. The criterion is false by construction for exactly two words;
 * it is reported, and these two are searched with `'strict'`.
 */
export const RULES_LEXICON_ACCENT_SENSITIVE = ['dé', 'dés'] as const;

/** `no_outcome_decision`. Formulations the `<fait>` has not already settled. */
export const OUTCOME_DECISION_LEXICON = [
  'tu réussis',
  'tu échoues',
  'tu parviens à',
  'tu rates',
  'tu meurs',
  'tu perds',
  'tu gagnes',
  'tu es tué',
  'jette',
  'fais un jet',
  'lance les dés',
  'tu dois choisir entre',
] as const;

/** `no_ooc_lexicon`. Out-of-world vocabulary — video game, not saga. */
export const OOC_LEXICON = [
  'mana',
  'niveau',
  'XP',
  'points de vie',
  'statistique',
  'ulti',
  'cooldown',
  'lane',
  'buff',
  'nerf',
  'respawn',
  'quête',
  'inventaire',
] as const;

/** `banned_style_lexicon`. The measured register lever, after the examples. */
export const BANNED_STYLE_LEXICON = [
  'semble',
  'semblent',
  'semblait',
  'semblaient',
  'paraît',
  'paraissent',
  'paraissait',
  'une sorte de',
  'une espèce de',
  'comme si',
  'quelque chose de',
  "quelque chose d'",
  'mystérieux',
  'mystérieuse',
  'mystère',
  'étrange',
  'étrangement',
  'indéchiffrable',
  'indicible',
  'insondable',
  'palpable',
  'oppressant',
  'oppressante',
] as const;

/** `no_named_emotion`. The closed list of feelings that must not be named. */
export const NAMED_EMOTIONS = [
  'peur',
  'angoisse',
  'inquiétude',
  'terreur',
  'colère',
  'tristesse',
  'joie',
  'espoir',
  'désespoir',
  'soulagement',
  'malaise',
  'effroi',
] as const;

/** `no_atmosphere_ending`. Searched in the LAST sentence only. */
export const ATMOSPHERE_ENDINGS = [
  'atmosphère',
  'ambiance',
  'pesant',
  'pesante',
  'lourd de',
  'lourde de',
  'chargé de',
  'chargée de',
  'plane sur',
  'règne',
  "s'installe",
  'se fait sentir',
  'menaçant',
  'menaçante',
] as const;

/** `no_anonymous_recurrent`. Two occurrences of the same one is the failure. */
export const ANONYMOUS_TERMS = [
  "l'homme",
  'la femme',
  "l'inconnu",
  "l'inconnue",
  'la silhouette',
  "l'étranger",
  "l'étrangère",
  'le vieillard',
  'la vieille',
  'la créature',
] as const;

/** `no_absent_reappearance`. What MAKES a mention of an absent legitimate. */
export const ABSENCE_MARKERS = [
  'parti',
  'partie',
  'partis',
  'disparu',
  'disparue',
  'mort',
  'morte',
  'plus là',
  "n'est plus",
  'laissé',
  'laissée',
  'derrière',
  'trace',
  'sang',
  'vide',
  'avant',
] as const;

/** `language_fr`. Function words, both directions. */
export const FRENCH_FUNCTION_WORDS = [
  'le',
  'la',
  'les',
  'de',
  'des',
  'du',
  'un',
  'une',
  'et',
  'dans',
  'sur',
  'tu',
  'ton',
  'qui',
  'que',
  'ne',
  'pas',
] as const;

export const ENGLISH_FUNCTION_WORDS = ['the', 'and', 'you', 'your', 'with', 'into'] as const;

/** `language_fr`: the ratio the spec fixes. */
export const FRENCH_FUNCTION_WORD_RATIO_MIN = 0.1;

/** `no_time_skip`. Not justified unless the `<fait>` carries the skip. */
export const TIME_SKIP_PATTERN =
  /\b(le lendemain|au matin|des jours|plusieurs jours|quand tu te réveilles|à l'aube|le soir venu)\b/iu;

/** `price_respected`: the shape of a price the narration dodged. */
export const PRICE_EVASION_PATTERN =
  /\b(mais|pourtant|heureusement)\b[^.]{0,60}\b(rien|indemne|épargn|sauf)/iu;

/** `no_terminal_prompt`: handing the turn back to the player. */
export const TERMINAL_PROMPT_PATTERN =
  /que fais[- ]tu|qu'est[- ]ce que tu (fais|décides)|que décides[- ]tu|comment réagis[- ]tu|à toi de jouer|c'est à toi/iu;

/** `no_pc_agency`: deciding for a player character. */
export const PC_AGENCY_PATTERN =
  /\btu (décides|choisis|penses|espères|veux|crois|te dis|réponds|demandes|ordonnes)\b/iu;

/** `ends_concrete` (N2): the sensory vocabulary that makes an ending concrete. */
export const SENSORY_LEXICON = [
  'neige',
  'glace',
  'vent',
  'sang',
  'froid',
  'fumée',
  'odeur',
  'bruit',
  'cri',
  'pierre',
  'corde',
  'lame',
  'feu',
  'os',
  'gel',
] as const;

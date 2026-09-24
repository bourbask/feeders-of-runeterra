/**
 * Codes to French sentences (01-architecture.md section 3.3).
 *
 * WHY THE CLIENT OWNS THE WORDING. The engine returns a `RuleViolationCode`
 * and the server an `AppErrorCode`; neither speaks French, and neither should.
 * A message built server-side would have to be translated at the boundary
 * anyway, and a client that matched on message strings would break the day a
 * word changed.
 *
 * TWO FAMILIES, NEVER FUSED, exactly as `zRejectionCode` keeps them apart: a
 * rule refusal is part of the fiction ("tu n'as pas assez d'élan"), a server
 * error is not ("la campagne est en reconstruction"). `rejectionMessage()`
 * accepts either, because that is what `s2c.rejected` carries.
 *
 * THE GUARD IS THE ENUMERATION, NOT THIS RECORD. `error-messages.test.ts`
 * walks `zRuleViolationCode.options` and `APP_ERROR_CODES` — the lists the
 * contracts own — and demands a sentence for each. It does NOT walk the keys
 * of the records below, which would be a list that is its own loop source:
 * emptying it would break nothing. A code added upstream turns that test red
 * here, which is the only reason it is worth writing.
 */

import type { AppErrorCode, RejectionCode } from '@for/contracts';

/** What the rules refused. Part of the fiction: it says what the world allows. */
export const RULE_VIOLATION_MESSAGES: Readonly<Record<string, string>> = {
  move_in_progress: 'Un mouvement est déjà en cours de résolution à cette table.',
  gauge_out_of_range: 'Cette jauge ne peut pas descendre ou monter plus loin.',
  unknown_move: 'Ce mouvement n’existe pas.',
  character_dead: 'Ce personnage est mort.',
  character_retired: 'Ce personnage s’est retiré de l’aventure.',
  character_not_in_campaign: 'Ce personnage n’est pas à cette table.',
  unknown_character: 'Ce personnage est introuvable.',
  unknown_track: 'Cette piste de progression est introuvable.',
  unknown_clock: 'Cette horloge est introuvable.',
  unknown_entity: 'Cette entité est introuvable.',
  unknown_oracle_table: 'Cette table d’oracle est introuvable.',
  campaign_not_active: 'Cette campagne n’est pas en cours.',
  not_a_member: 'Tu n’es pas membre de cette campagne.',
  attribute_spread_illegal: 'Cette répartition d’attributs n’est pas permise.',
  attribute_not_allowed: 'Cet attribut n’est pas permis pour ce mouvement.',
  champion_locked: 'Ce champion est déjà pris par un autre joueur de la table.',
  track_already_resolved: 'Cette piste est déjà résolue.',
  track_wrong_kind: 'Cette piste n’est pas du bon type pour ce mouvement.',
  no_burn_window: 'La fenêtre de brûlure du souffle est fermée.',
  momentum_too_low: 'Ton souffle est trop faible pour être brûlé.',
  insufficient_xp: 'Tu n’as pas assez d’expérience.',
  no_active_scene: 'Aucune scène n’est ouverte.',
  scene_capacity_exceeded: 'La scène porte déjà trop de présences.',
  target_not_present: 'Cette cible n’est pas dans la scène.',
};

/** What the server could not serve. Never part of the fiction. */
export const APP_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  protocol_version: 'Cette page est trop ancienne pour le serveur : recharge-la.',
  payload_too_large: 'Le message est trop gros pour être envoyé.',
  rate_limited: 'Trop de messages d’un coup : laisse passer un instant.',
  server_shutdown: 'Le serveur redémarre. La reconnexion est automatique.',
  campaign_rebuilding: 'La table se reconstruit. Reviens dans un instant.',
  unauthenticated: 'Ta session a expiré : reconnecte-toi avec Discord.',
  forbidden_campaign: 'Cette table ne t’est pas ouverte.',
  csrf_failed: 'Requête refusée par sécurité : recharge la page.',
  campaign_not_found: 'Cette table n’existe pas.',
  character_not_found: 'Ce personnage n’existe pas.',
  content_not_found: 'Ce contenu de jeu est introuvable.',
  route_not_found: 'Cette page n’existe pas.',
  validation_failed: 'Le serveur a refusé la requête : elle est mal formée.',
  conflict: 'Quelqu’un d’autre a modifié cela entre-temps.',
  ai_unavailable: 'Le conteur est indisponible : la partie continue sans sa prose.',
  ai_invalid_output: 'Le conteur a rendu un texte inutilisable : le moteur a pris le relais.',
  internal_error: 'Le serveur a rencontré une erreur. C’est noté côté serveur.',
};

/** Shown when a code reaches the screen that no sentence covers. */
export const UNKNOWN_CODE_MESSAGE = 'Le serveur a refusé, sans raison lisible.';

export function appErrorMessage(code: AppErrorCode): string {
  return APP_ERROR_MESSAGES[code] ?? UNKNOWN_CODE_MESSAGE;
}

/** `s2c.rejected` carries either family, so this one takes both. */
export function rejectionMessage(code: RejectionCode): string {
  return RULE_VIOLATION_MESSAGES[code] ?? APP_ERROR_MESSAGES[code] ?? UNKNOWN_CODE_MESSAGE;
}

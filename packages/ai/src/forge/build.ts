/**
 * The forge request (02-mj-ia.md section 9.2 and 9.4).
 *
 * `ForgeOutputSchema` is what the model is asked for: `ChampionSchema` minus
 * the six fields the SERVER owns — `schemaVersion`, `id`, `source`,
 * `portraitUrl`, `relations` and `aliases`. The forge has no privilege: the
 * completed sheet is revalidated against the one and only `ChampionSchema`
 * before it is inserted (V12).
 *
 * The allowed starting-asset identifiers travel in the `<lore>` block of the
 * user message, so an identifier outside the list is a repair (V11) rather
 * than a refusal.
 */

import { ForgeOutputSchema, type ForgeOutput, type StructureRequest } from '@for/contracts';

export interface ForgeRequestInput {
  readonly requestId: string;
  readonly systemPrompt: string;
  /** The champion asked for, its region, and what the lore says. */
  readonly brief: string;
  /** Asset identifiers the sheet may use. */
  readonly allowedAssetIds: readonly string[];
  /** Appended to the USER message on a retry (section 9.5). */
  readonly corrections?: string | undefined;
  readonly maxOutputTokens: number;
}

export function buildForgeRequest(input: ForgeRequestInput): StructureRequest<ForgeOutput> {
  const lore = [
    '<lore>',
    `Atouts de départ autorisés : ${input.allowedAssetIds.join(', ')}`,
    '</lore>',
  ].join('\n');
  const user = [input.brief, lore, input.corrections ?? '']
    .filter((part) => part.length > 0)
    .join('\n\n');
  return {
    purpose: 'forge',
    requestId: input.requestId,
    system: [{ type: 'text', text: input.systemPrompt, cacheHint: 'stable' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    schema: ForgeOutputSchema,
    schemaName: 'fiche_de_champion',
    maxOutputTokens: input.maxOutputTokens,
    effort: 'medium',
  };
}

/** The `<corrections>` block of section 9.5: the rules violated, and the fields. */
export function buildForgeCorrections(
  findings: readonly { readonly check: string; readonly detail: string }[],
): string {
  if (findings.length === 0) return '';
  const lines = findings.map((finding) => `- ${finding.check} : ${finding.detail}`);
  return ['<corrections>', ...lines, '</corrections>'].join('\n');
}

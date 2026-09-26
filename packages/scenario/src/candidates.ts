/**
 * Filtering by period, and the shuffle on the named stream (ADR 0012
 * decisions 1 and 6).
 *
 * ── THE PERIOD FILTERS EVERYTHING ────────────────────────────────────────
 * All six scenario families carry a `periodId`, hook included — S-01 added it
 * for exactly this. So every candidate list in this package goes through one
 * of the functions below, and none of them reads `list*()` directly. The
 * failure being prevented is the first one `04-scenarios.md` section 6 names:
 * a character meeting somebody dead for three centuries.
 *
 * `absentFactionIds` gets the second half of the job. A period NAMES the
 * factions that do not exist yet; a figure or a ressort attached to one of
 * them is dropped from the candidates even if its `periodId` matches, because
 * a `periodId` written by hand can be wrong and an explicit absence cannot.
 *
 * ── WHY EACH STEP DRAWS ON ITS OWN SUB-STREAM ────────────────────────────
 * `seed|scenario|<stepId>`, not one running stream. Step B runs LATER, after
 * the distribution, possibly in another process: a running stream would make
 * its draws depend on how many candidates step 1 happened to have, and
 * resuming a build would mean replaying phase A's shuffles to get the
 * generator back to the right place. Sub-streams make `buildHooks` resumable
 * from nothing but the seed, which is invariant 4 down in the genesis.
 *
 * The input order is `listX()`'s — sorted by identifier, guaranteed by
 * `@for/content`'s registry — so the shuffle starts from a deterministic base
 * and the whole build is reproducible bit for bit.
 */

import { createSeededRng } from '@for/engine';

import type { ContentRegistry } from '@for/content';
import type {
  EncounterContent,
  FigureContent,
  FrontContent,
  HookContent,
  NodeContent,
  PeriodContent,
} from '@for/contracts';

import { SCENARIO_RNG_STREAM } from './types.js';

/** `seed|scenario|<stepId>`. The named stream of decision 6, per step. */
export function scenarioStreamSeed(seed: string, stepId: string): string {
  return `${seed}|${SCENARIO_RNG_STREAM}|${stepId}`;
}

/**
 * Fisher-Yates on the step's sub-stream.
 *
 * Same seed and same input order give the same output, always — held by
 * `tests/candidates.test.ts` « le mélange sur le flux nommé » › « même graine,
 * même étape : le même tableau exact ». The engine's
 * `createSeededRng` is reused rather than reimplemented: a second generator
 * would be a second answer to "how does this project draw".
 */
export function shuffleFor<T>(seed: string, stepId: string, items: readonly T[]): readonly T[] {
  const rng = createSeededRng(scenarioStreamSeed(seed, stepId));
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = rng.roll(index + 1) - 1;
    const here = out[index] as T;
    const there = out[swap] as T;
    out[index] = there;
    out[swap] = here;
  }
  return out;
}

/** True when the period explicitly says this faction is not around. */
export function isAbsentFaction(period: PeriodContent, factionId: string | null): boolean {
  if (factionId === null) return false;
  return period.absentFactionIds.includes(factionId);
}

export function frontsOfPeriod(
  registry: ContentRegistry,
  periodId: string,
): readonly FrontContent[] {
  return registry.listFronts().filter((front) => front.periodId === periodId);
}

export function nodesOfPeriod(registry: ContentRegistry, periodId: string): readonly NodeContent[] {
  return registry.listNodes().filter((node) => node.periodId === periodId);
}

export function figuresOfPeriod(
  registry: ContentRegistry,
  period: PeriodContent,
): readonly FigureContent[] {
  return registry
    .listFigures()
    .filter(
      (figure) => figure.periodId === period.id && !isAbsentFaction(period, figure.factionId),
    );
}

export function hooksOfPeriod(
  registry: ContentRegistry,
  period: PeriodContent,
): readonly HookContent[] {
  return registry.listHooks().filter((hook) => {
    if (hook.periodId !== period.id) return false;
    if (hook.appliesTo.kind !== 'faction') return true;
    return !isAbsentFaction(period, hook.appliesTo.factionId);
  });
}

export function encountersOfPeriod(
  registry: ContentRegistry,
  periodId: string,
): readonly EncounterContent[] {
  return registry.listEncounters().filter((encounter) => encounter.periodId === periodId);
}

/**
 * The regions this period actually plays in, sorted.
 *
 * A region carries no `periodId` — it is the one family that outlives every
 * period — so "the regions of a period" is read off the pieces that DO carry
 * one: the fronts that threaten them and the nodes that sit in them.
 */
export function regionIdsOfPeriod(registry: ContentRegistry, periodId: string): readonly string[] {
  const ids = new Set<string>();
  for (const front of frontsOfPeriod(registry, periodId)) {
    for (const regionId of front.regionIds) ids.add(regionId);
  }
  for (const node of nodesOfPeriod(registry, periodId)) ids.add(node.regionId);
  return [...ids].sort();
}

/**
 * The regions of a period a situation can actually be BUILT in.
 *
 * Narrower than `regionIdsOfPeriod` on purpose, and the difference was
 * measured rather than guessed: a region a front threatens but where no node
 * opens leaves the `noeud` step with nothing, and a build that has already
 * asked the model four questions dies on a refusal the caller can do nothing
 * about. So a region is a candidate only when the period puts BOTH a front and
 * an entry node in it.
 *
 * Held by `tests/steps.test.ts` « chaque étape ferme sa liste sur la période »
 * › « une région sans point d'entrée n'est pas jouable, même si un front la
 * menace ».
 */
export function playableRegionIds(registry: ContentRegistry, periodId: string): readonly string[] {
  const threatened = new Set<string>();
  for (const front of frontsOfPeriod(registry, periodId)) {
    for (const regionId of front.regionIds) threatened.add(regionId);
  }
  const entered = new Set<string>();
  for (const node of nodesOfPeriod(registry, periodId)) {
    if (node.entryPoint) entered.add(node.regionId);
  }
  return [...threatened].filter((regionId) => entered.has(regionId)).sort();
}

/**
 * The periods a scenario can be built on at all.
 *
 * A period with no front, no figure or no playable region is not a period the
 * model should be offered: choosing it would spend the first question and then
 * refuse. The filter belongs HERE, at the first step, because that is the only
 * place where the refusal can still be avoided instead of reported.
 *
 * This does not hide a content hole — `pnpm content:check` and S-02's graph
 * pass are what report those — it stops a hole from becoming a half-built
 * campaign.
 */
export function playablePeriods(registry: ContentRegistry): readonly PeriodContent[] {
  return registry
    .listPeriods()
    .filter(
      (period) =>
        figuresOfPeriod(registry, period).length > 0 &&
        playableRegionIds(registry, period.id).length > 0,
    );
}

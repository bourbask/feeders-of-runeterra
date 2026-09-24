/**
 * Typed access to a loaded bundle (01-architecture.md section 2.5).
 *
 * EVERY `get*` THROWS ON AN UNKNOWN ID. That is the whole reason this file
 * exists rather than callers reaching into the maps: the failure M0-14 is
 * written to prevent is "an `undefined` that travels all the way into the
 * storyteller's prompt". A `Map.get` hands you that `undefined` politely; a
 * `getMove('endure-could')` says which id, and lists the ones that exist.
 *
 * `find*` is there for the caller who genuinely has an optional id, and it is
 * the only shape that may answer `undefined`.
 */

import type {
  AssetContent,
  ChampionContent,
  ChampionIndexEntryContent,
  ConditionContent,
  MoveContent,
  OracleTableContent,
  RegionContent,
  TruthContent,
} from '@for/contracts';

import type { ContentBundle } from './validate.js';
import { suggest } from './validate.js';

export class UnknownContentIdError extends Error {
  public constructor(
    public readonly kind: string,
    public readonly id: string,
    known: Iterable<string>,
  ) {
    const hint = suggest(id, known);
    super(
      `${kind} « ${id} » absent du contenu chargé` +
        (hint === undefined ? '' : ` (suggestion : « ${hint} »)`),
    );
    this.name = 'UnknownContentIdError';
  }
}

const required = <T>(map: ReadonlyMap<string, T>, kind: string, id: string): T => {
  const found = map.get(id);
  if (found === undefined) throw new UnknownContentIdError(kind, id, map.keys());
  return found;
};

export interface ContentRegistry {
  readonly bundle: ContentBundle;

  getMove(id: string): MoveContent;
  findMove(id: string): MoveContent | undefined;
  listMoves(): readonly MoveContent[];

  getChampion(id: string): ChampionContent;
  findChampion(id: string): ChampionContent | undefined;
  listChampions(): readonly ChampionContent[];

  getChampionIndexEntry(id: string): ChampionIndexEntryContent;
  listChampionIndex(): readonly ChampionIndexEntryContent[];

  getRegion(id: string): RegionContent;
  listRegions(): readonly RegionContent[];

  getOracle(id: string): OracleTableContent;
  listOracles(): readonly OracleTableContent[];

  getAsset(id: string): AssetContent;
  listAssets(): readonly AssetContent[];

  getCondition(id: string): ConditionContent;
  listConditions(): readonly ConditionContent[];

  listTruths(): readonly TruthContent[];
}

const sorted = <T>(map: ReadonlyMap<string, T>): readonly T[] =>
  [...map.keys()].sort().map((key) => map.get(key) as T);

export function createRegistry(bundle: ContentBundle): ContentRegistry {
  return Object.freeze({
    bundle,

    getMove: (id: string) => required(bundle.moves, 'mouvement', id),
    findMove: (id: string) => bundle.moves.get(id),
    listMoves: () => sorted(bundle.moves),

    getChampion: (id: string) => required(bundle.champions, 'champion', id),
    findChampion: (id: string) => bundle.champions.get(id),
    listChampions: () => sorted(bundle.champions),

    getChampionIndexEntry: (id: string) => required(bundle.championIndex, 'champion', id),
    listChampionIndex: () => sorted(bundle.championIndex),

    getRegion: (id: string) => required(bundle.regions, 'région', id),
    listRegions: () => sorted(bundle.regions),

    getOracle: (id: string) => required(bundle.oracles, 'oracle', id),
    listOracles: () => sorted(bundle.oracles),

    getAsset: (id: string) => required(bundle.assets, 'atout', id),
    listAssets: () => sorted(bundle.assets),

    getCondition: (id: string) => required(bundle.conditions, 'condition', id),
    listConditions: () => sorted(bundle.conditions),

    listTruths: () => bundle.truths,
  });
}

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
  EncounterContent,
  FigureContent,
  FrontContent,
  HookContent,
  MoveContent,
  NodeContent,
  OracleTableContent,
  PeriodContent,
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

  // ADR 0012 — the six scenario families. `find*` alongside `get*` on every
  // one of them, because S-04 walks candidate lists and legitimately asks for
  // an id that the chosen period filtered out: that caller has an OPTIONAL id,
  // which is the one shape allowed to answer `undefined` (see the header).
  getPeriod(id: string): PeriodContent;
  findPeriod(id: string): PeriodContent | undefined;
  listPeriods(): readonly PeriodContent[];

  getFront(id: string): FrontContent;
  findFront(id: string): FrontContent | undefined;
  listFronts(): readonly FrontContent[];

  getNode(id: string): NodeContent;
  findNode(id: string): NodeContent | undefined;
  listNodes(): readonly NodeContent[];

  getFigure(id: string): FigureContent;
  findFigure(id: string): FigureContent | undefined;
  listFigures(): readonly FigureContent[];

  getHook(id: string): HookContent;
  findHook(id: string): HookContent | undefined;
  listHooks(): readonly HookContent[];

  getEncounter(id: string): EncounterContent;
  findEncounter(id: string): EncounterContent | undefined;
  listEncounters(): readonly EncounterContent[];
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

    getPeriod: (id: string) => required(bundle.periods, 'période', id),
    findPeriod: (id: string) => bundle.periods.get(id),
    listPeriods: () => sorted(bundle.periods),

    getFront: (id: string) => required(bundle.fronts, 'front', id),
    findFront: (id: string) => bundle.fronts.get(id),
    listFronts: () => sorted(bundle.fronts),

    getNode: (id: string) => required(bundle.nodes, 'nœud', id),
    findNode: (id: string) => bundle.nodes.get(id),
    listNodes: () => sorted(bundle.nodes),

    getFigure: (id: string) => required(bundle.figures, 'figure', id),
    findFigure: (id: string) => bundle.figures.get(id),
    listFigures: () => sorted(bundle.figures),

    getHook: (id: string) => required(bundle.hooks, 'ressort', id),
    findHook: (id: string) => bundle.hooks.get(id),
    listHooks: () => sorted(bundle.hooks),

    getEncounter: (id: string) => required(bundle.encounters, 'rencontre', id),
    findEncounter: (id: string) => bundle.encounters.get(id),
    listEncounters: () => sorted(bundle.encounters),
  });
}

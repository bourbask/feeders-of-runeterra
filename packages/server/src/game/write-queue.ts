/**
 * ONE WRITE AT A TIME PER CAMPAIGN, and no order beyond that.
 *
 * ARCHITECTURE.md section 4.4, first row: "Ordre du tour: AUCUN. La table est
 * libre. Ecritures serialisees par campagne (une file par `campaign_id`). Code
 * de refus: `move_in_progress`, jamais `not_your_turn`." Two things follow, and
 * they are easy to confuse:
 *
 *   - THIS FILE IS NOT A TURN LOCK. It decides nothing about whose turn it is;
 *     it only stops two intents of the SAME table from deciding against the
 *     same state at the same time. Two tables never wait on each other, which
 *     is what `run` proves by keying the chain on the campaign.
 *   - `move_in_progress` IS NOT EMITTED HERE either. It belongs to the actor
 *     who has a roll awaiting a burn decision (01-architecture.md section 3.3),
 *     which is a question about the journal, not about this queue. It lives in
 *     `intent-pipeline.ts`, next to the burn window it is about.
 *
 * WHY SERIALISING MATTERS MECHANICALLY, and not just for tidiness: `decide()`
 * numbers the entries it produces from `state.seq`, and every payload that
 * points at another entry — `move.resolved.rollSeq`,
 * `roll.action_revised.revisedFromSeq`, `BriefAppliedEffect.eventSeq` — is
 * written from that numbering. The database allocates the real `seq` on
 * insert. The two agree only while nothing else writes between the load and
 * the insert. Without this queue, two concurrent intents would each decide
 * against `seq = N`, and the second batch would carry payloads pointing at
 * sequences that belong to the first.
 *
 * THE CHAIN IS MEMORY, and that is correct rather than a shortcut: SQLite WAL
 * makes the process a single writer (03-donnees.md section 0.3) and the
 * deployment declares one replica (ARCHITECTURE.md section 4.5). A second
 * process would need a lock in the database, and it would also need a second
 * database.
 */

/** What a campaign's queue holds: the tail of its promise chain. */
type Chain = Promise<unknown>;

export interface WriteQueue {
  /**
   * Runs `job` once every job queued earlier for `campaignId` has settled.
   *
   * A job that throws does NOT poison the queue: the chain continues with the
   * next job, and the rejection goes to that job's own caller. A queue that a
   * single failure wedged would turn one bad intent into a dead table.
   */
  run<T>(campaignId: string, job: () => Promise<T>): Promise<T>;
  /** How many campaigns currently hold a chain. Read by tests, and by nothing else. */
  size(): number;
}

export function createWriteQueue(): WriteQueue {
  const chains = new Map<string, Chain>();

  function run<T>(campaignId: string, job: () => Promise<T>): Promise<T> {
    const previous = chains.get(campaignId) ?? Promise.resolve();
    // `catch` BEFORE `then`: the tail this job waits on must settle whatever
    // the previous job did, otherwise one rejection stops the campaign for good.
    const result = previous.then(
      () => job(),
      () => job(),
    );
    // The tail is the SWALLOWED result. Storing `result` itself would leave an
    // unhandled rejection on the chain when a caller handles its own.
    const tail: Chain = result.then(
      () => undefined,
      () => undefined,
    );
    chains.set(campaignId, tail);
    void tail.then(() => {
      // Drop the entry only if nothing was queued behind: an idle table must
      // not keep a promise alive, and a busy one must not lose its chain.
      if (chains.get(campaignId) === tail) chains.delete(campaignId);
    });
    return result;
  }

  return { run, size: () => chains.size };
}

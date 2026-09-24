import { describe, expect, it } from 'vitest';

import {
  boxesFilled,
  clampTicks,
  fillBoxes,
  fullTrackTicks,
  markProgress,
  ticksForMilestones,
  ticksRemaining,
} from './progress-track.js';
import { MAX_PROGRESS_TICKS, PROGRESS_RANKS, TICKS_PER_MILESTONE } from './types/progress.js';

describe('the shape of a track', () => {
  it('holds ten boxes of four ticks: forty', () => {
    expect(fullTrackTicks()).toBe(40);
    expect(MAX_PROGRESS_TICKS).toBe(40);
  });

  it('clamps a tick count to the track', () => {
    expect(clampTicks(-5)).toBe(0);
    expect(clampTicks(41)).toBe(40);
    expect(clampTicks(17)).toBe(17);
  });

  it('counts only complete boxes', () => {
    expect(boxesFilled(0)).toBe(0);
    expect(boxesFilled(3)).toBe(0);
    expect(boxesFilled(4)).toBe(1);
    expect(boxesFilled(39)).toBe(9);
    expect(boxesFilled(40)).toBe(10);
  });

  it('never reports a box a track could not hold', () => {
    expect(boxesFilled(99)).toBe(10);
    expect(boxesFilled(-4)).toBe(0);
  });

  it('says how much is missing', () => {
    expect(ticksRemaining(0)).toBe(40);
    expect(ticksRemaining(33)).toBe(7);
    expect(ticksRemaining(40)).toBe(0);
    expect(ticksRemaining(99)).toBe(0);
  });
});

describe('ticksForMilestones', () => {
  it('gives each rank its worth: 12 / 8 / 4 / 2 / 1', () => {
    // The five numbers, read from the one constant that carries them. This is
    // the assertion the canary breaks when TICKS_PER_MILESTONE is edited.
    expect(PROGRESS_RANKS.map((rank) => ticksForMilestones(rank, 1))).toEqual([12, 8, 4, 2, 1]);
  });

  it('multiplies by the number of milestones', () => {
    expect(ticksForMilestones('genant', 3)).toBe(36);
    expect(ticksForMilestones('epique', 7)).toBe(7);
    expect(ticksForMilestones('redoutable', 0)).toBe(0);
  });
});

describe('markProgress', () => {
  it('marks one milestone by default', () => {
    expect(markProgress(0, 'dangereux')).toEqual({
      ticks: 8,
      filledBoxes: 2,
      ticksApplied: 8,
      complete: false,
    });
  });

  it('fills an empty genant track in four milestones, and no sooner', () => {
    let ticks = 0;
    for (let mark = 1; mark <= 3; mark += 1) {
      const change = markProgress(ticks, 'genant');
      ticks = change.ticks;
      expect(change.complete).toBe(false);
    }
    expect(ticks).toBe(36);
    expect(markProgress(ticks, 'genant')).toEqual({
      ticks: 40,
      filledBoxes: 10,
      ticksApplied: 4,
      complete: true,
    });
  });

  it('needs forty milestones on an epique track', () => {
    let ticks = 0;
    for (let mark = 0; mark < 40; mark += 1) ticks = markProgress(ticks, 'epique').ticks;
    expect(ticks).toBe(40);
    expect(boxesFilled(ticks)).toBe(10);
  });

  it('reports what actually landed against the ceiling', () => {
    expect(markProgress(38, 'genant')).toEqual({
      ticks: 40,
      filledBoxes: 10,
      ticksApplied: 2,
      complete: true,
    });
  });

  it('marks backwards on a negative milestone count, down to the floor', () => {
    expect(markProgress(10, 'redoutable', -1)).toEqual({
      ticks: 6,
      filledBoxes: 1,
      ticksApplied: -4,
      complete: false,
    });
    expect(markProgress(2, 'genant', -1)).toEqual({
      ticks: 0,
      filledBoxes: 0,
      ticksApplied: -2,
      complete: false,
    });
  });

  it('is complete only on the fortieth tick, never one short', () => {
    expect(markProgress(37, 'extreme')).toEqual({
      ticks: 39,
      filledBoxes: 9,
      ticksApplied: 2,
      complete: false,
    });
    expect(markProgress(38, 'extreme').ticks).toBe(40);
    expect(markProgress(38, 'extreme').complete).toBe(true);
  });

  it('never reads the milestone table twice the same way', () => {
    for (const rank of PROGRESS_RANKS) {
      expect(markProgress(0, rank).ticks).toBe(TICKS_PER_MILESTONE[rank]);
    }
  });
});

describe('fillBoxes', () => {
  it('fills whole boxes, whatever the rank', () => {
    expect(fillBoxes(0, 2)).toEqual({
      ticks: 8,
      filledBoxes: 2,
      ticksApplied: 8,
      complete: false,
    });
  });

  it('adds to a partly filled box rather than rounding it', () => {
    expect(fillBoxes(3, 1)).toEqual({ ticks: 7, filledBoxes: 1, ticksApplied: 4, complete: false });
  });

  it('stops at the ceiling and says how much landed', () => {
    expect(fillBoxes(36, 3)).toEqual({
      ticks: 40,
      filledBoxes: 10,
      ticksApplied: 4,
      complete: true,
    });
  });

  it('empties boxes on a negative count', () => {
    expect(fillBoxes(20, -3).ticks).toBe(8);
    expect(fillBoxes(4, -3).ticks).toBe(0);
  });

  it('measures a change from inside the track, not from an impossible value', () => {
    expect(fillBoxes(99, 1).ticksApplied).toBe(0);
  });
});

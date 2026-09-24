/**
 * The barrel is the package's only public surface, so it gets a test of its
 * own: the four folders of wave 4 exist and are re-exported, and the names the
 * rest of the milestone is going to import actually come out of it. A schema
 * that compiles but is not exported is a schema someone will redeclare.
 */
import { describe, expect, it } from 'vitest';

import * as contracts from './index.js';

describe('@for/contracts — la surface publique', () => {
  it.each([
    'zCampaignState',
    'zGameEvent',
    'zIntent',
    'zTableState',
    'zTurnProof',
    'zEngineEffect',
    'EffectSchema',
    'zSceneState',
    'zRuleViolation',
    'zAppErrorPayload',
    'upcast',
    'PROTOCOL_VERSION',
    'EVENT_SCHEMA_VERSION',
    'CONTENT_SCHEMA_VERSION',
  ])('exporte %s', (name) => {
    expect(contracts).toHaveProperty(name);
  });

  it('les trois versions sont des entiers positifs', () => {
    expect(contracts.PROTOCOL_VERSION).toBeGreaterThan(0);
    expect(contracts.EVENT_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(contracts.CONTENT_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

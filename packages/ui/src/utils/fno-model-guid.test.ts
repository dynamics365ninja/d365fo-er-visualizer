import { describe, it, expect } from 'vitest';
import type { ErConfigSummary } from '@er-visualizer/fno-client';
import { inheritsFromOwnDataModel, normalizeGuid, scoutedDataModelGuid } from './fno-model-guid';

const ZERO = '00000000-0000-0000-0000-000000000000';
const MODEL_GUID = 'd1f0a0e1-1111-4111-8111-111111111111';
/** Id of the base format the derived format below inherits from. */
const BASE_FORMAT_GUID = 'b0a5e000-2222-4222-8222-222222222222';

/** A format listed directly under its data model. */
function topLevelFormat(extra: Partial<ErConfigSummary> = {}): ErConfigSummary {
  return {
    solutionName: 'Bank statement model',
    configurationName: 'Statement import format',
    componentType: 'Format',
    configurationGuid: 'f0000001-3333-4333-8333-333333333333',
    hasContent: true,
    ownerDataModelName: 'Bank statement model',
    parentConfigName: 'Bank statement model',
    derivationDepth: 0,
    ...extra,
  };
}

/** A format derived from another format. */
function derivedFormat(extra: Partial<ErConfigSummary> = {}): ErConfigSummary {
  return {
    solutionName: 'Bank statement model',
    configurationName: 'Statement import format (derived)',
    componentType: 'Format',
    configurationGuid: 'f0000002-4444-4444-8444-444444444444',
    hasContent: true,
    ownerDataModelName: 'Bank statement model',
    parentConfigName: 'Statement import format',
    derivationDepth: 1,
    ...extra,
  };
}

describe('normalizeGuid', () => {
  it('strips braces and lowercases', () => {
    expect(normalizeGuid(`{${BASE_FORMAT_GUID.toUpperCase()}}`)).toBe(BASE_FORMAT_GUID);
    expect(normalizeGuid(undefined)).toBe('');
  });
});

describe('inheritsFromOwnDataModel', () => {
  it('holds for a configuration listed directly under its model', () => {
    expect(inheritsFromOwnDataModel(topLevelFormat())).toBe(true);
  });

  it('does not hold for a format derived from another format', () => {
    expect(inheritsFromOwnDataModel(derivedFormat())).toBe(false);
  });

  it('does not hold when the listing says nothing about the parent', () => {
    expect(inheritsFromOwnDataModel({})).toBe(false);
  });
});

describe('scoutedDataModelGuid', () => {
  it('takes an own Model= reference regardless of where the format sits', () => {
    expect(scoutedDataModelGuid(derivedFormat(), [MODEL_GUID])).toBe(MODEL_GUID);
  });

  it('prefers an own reference over a Base= one', () => {
    expect(
      scoutedDataModelGuid(
        derivedFormat(),
        [BASE_FORMAT_GUID, MODEL_GUID],
        new Set([BASE_FORMAT_GUID]),
      ),
    ).toBe(MODEL_GUID);
  });

  it('refuses the base FORMAT id of a derived format', () => {
    // The whole point: a derived format carries Base="{base format},N".
    // Accepting it named the base format as the data model, which F&O answers
    // empty — and the same wrong id was then used as `_dataModelGuid` for every
    // mapping probe, so the mapping failed too.
    expect(
      scoutedDataModelGuid(derivedFormat(), [BASE_FORMAT_GUID], new Set([BASE_FORMAT_GUID])),
    ).toBeUndefined();
  });

  it('accepts a Base= id when the format is listed directly under the model', () => {
    expect(
      scoutedDataModelGuid(topLevelFormat(), [MODEL_GUID], new Set([MODEL_GUID])),
    ).toBe(MODEL_GUID);
  });

  it('ignores zero and empty GUIDs', () => {
    expect(scoutedDataModelGuid(topLevelFormat(), [ZERO, ''])).toBeUndefined();
    expect(scoutedDataModelGuid(topLevelFormat(), undefined)).toBeUndefined();
  });

  it('normalizes braces and case in the value it returns', () => {
    expect(scoutedDataModelGuid(derivedFormat(), [`{${MODEL_GUID.toUpperCase()}}`])).toBe(MODEL_GUID);
  });
});

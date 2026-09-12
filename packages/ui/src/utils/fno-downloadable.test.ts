import { describe, it, expect } from 'vitest';
import type { ErConfigSummary } from '@er-visualizer/fno-client';
import { fnoUndownloadableReason, isFnoComponentDownloadable, isUsableGuid } from './fno-downloadable';

const ZERO = '00000000-0000-0000-0000-000000000000';

function format(extra: Partial<ErConfigSummary> = {}): ErConfigSummary {
  return {
    solutionName: 'Invoice model',
    configurationName: 'Asl Sales invoice (Excel)',
    componentType: 'Format',
    configurationGuid: 'afed2936-3761-4042-b8ac-f41850b15672',
    hasContent: true,
    ...extra,
  };
}

describe('isUsableGuid', () => {
  it('rejects empty and zero GUIDs, with or without braces', () => {
    expect(isUsableGuid(undefined)).toBe(false);
    expect(isUsableGuid('')).toBe(false);
    expect(isUsableGuid(ZERO)).toBe(false);
    expect(isUsableGuid(`{${ZERO}}`)).toBe(false);
    expect(isUsableGuid('afed2936-3761-4042-b8ac-f41850b15672')).toBe(true);
  });
});

describe('fnoUndownloadableReason', () => {
  it('lets a format with a usable id through', () => {
    expect(fnoUndownloadableReason(format())).toBeNull();
    expect(isFnoComponentDownloadable(format())).toBe(true);
  });

  it('refuses a draft-only configuration even though its id looks fine', () => {
    // The whole point: F&O serves the completed (effective) version, so this
    // id resolves to an empty body. Queueing it downloads nothing and lets the
    // rest of the pipeline fall back to the base configuration instead.
    const draft = format({ draftOnly: true, versionNumbers: [1] });
    expect(fnoUndownloadableReason(draft)).toBe('draft-only');
    expect(isFnoComponentDownloadable(draft)).toBe(false);
  });

  it('keeps the draft reason ahead of every id-based one', () => {
    const draft = format({ draftOnly: true, configurationGuid: undefined, revisionGuid: undefined });
    expect(fnoUndownloadableReason(draft)).toBe('draft-only');
  });

  it('accepts a mapping without its own id when the parent model can resolve it', () => {
    const mapping = format({
      componentType: 'ModelMapping',
      configurationName: 'Asl Invoice model mapping',
      configurationGuid: undefined,
      parentDataModelGuid: 'e1534820-3b67-4266-ace3-663d9ef0eb09',
    });
    expect(fnoUndownloadableReason(mapping)).toBeNull();
  });

  it('reports an unreachable mapping when there is no parent to resolve through', () => {
    const mapping = format({
      componentType: 'ModelMapping',
      configurationGuid: undefined,
      revisionGuid: undefined,
    });
    expect(fnoUndownloadableReason(mapping)).toBe('unreachable-mapping');
  });

  it('reports no content for any other row without a usable id', () => {
    expect(fnoUndownloadableReason(format({ configurationGuid: ZERO }))).toBe('no-content');
  });
});

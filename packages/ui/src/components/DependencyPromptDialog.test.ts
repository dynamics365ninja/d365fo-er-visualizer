import { describe, expect, it } from 'vitest';
import { initiallyChecked, type DependencyPromptRequest } from './DependencyPromptDialog';

const request = (candidates: DependencyPromptRequest['candidates']): DependencyPromptRequest => ({
  subjectName: 'Statement format',
  subjectKind: 'Format',
  candidates,
});

describe('initiallyChecked', () => {
  it('ticks every candidate unless told otherwise', () => {
    expect(initiallyChecked(request([
      { key: 'model', kind: 'DataModel', name: 'Statement model' },
      { key: 'mapping', kind: 'ModelMapping', name: 'Statement mapping' },
    ]))).toEqual(new Set(['model', 'mapping']));
  });

  it('leaves the candidates the user has to choose from, and those that cannot be loaded, unticked', () => {
    expect(initiallyChecked(request([
      { key: 'model', kind: 'DataModel', name: 'Statement model' },
      { key: 'base', kind: 'ModelMapping', name: 'Mapping to destination', preselected: false },
      { key: 'no-id', kind: 'ModelMapping', name: 'Base mapping', unavailable: 'no id from F&O' },
    ]))).toEqual(new Set(['model']));
  });

  it('is empty without a request', () => {
    expect(initiallyChecked(null).size).toBe(0);
  });
});

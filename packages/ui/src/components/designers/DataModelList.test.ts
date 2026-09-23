import { describe, expect, it } from 'vitest';
import { collectFieldPaths, modelExpression } from './DataModelList';

const containers = [
  { id: 'root', name: 'Invoice model', isRoot: true, items: [
    { name: 'Header', type: 10, typeDescriptor: 'hdr' },
    { name: 'Lines', type: 11, typeDescriptor: 'line' },
    { name: 'Status', type: 9, typeDescriptor: 'enum' },
  ] },
  { id: 'hdr', name: 'Header', items: [{ name: 'Invoice date', type: 7 }] },
  { id: 'line', name: 'Line', items: [{ name: 'Amount', type: 5 }, { name: 'Parent', type: 10, typeDescriptor: 'hdr' }] },
  { id: 'enum', name: 'Status', isEnum: true, isRoot: true, items: [{ name: 'Open', type: 0 }] },
] as any[];

describe('data model list', () => {
  it('reaches every field from the root once, by its shortest path', () => {
    const paths = collectFieldPaths(containers).map(p => p.segments.join('/'));
    expect(paths).toEqual(['Header', 'Lines', 'Status', 'Header/Invoice date', 'Lines/Amount', 'Lines/Parent']);
  });

  it('writes a field as the model expression a binding would use', () => {
    expect(modelExpression(['Header', 'Invoice date'])).toBe("model.Header.'Invoice date'");
  });
});

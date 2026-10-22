import { describe, expect, it } from 'vitest';
import { arrangeSections, dropSection, moveSection, sanitizeSectionLayout, type SectionKind } from './explorer-sections';

describe('explorer sections', () => {
  it('makes a stored layout whole', () => {
    expect(sanitizeSectionLayout({ order: ['Format', 'Format', 'Bogus'], collapsed: ['DataModel', 7] })).toEqual({
      order: ['Format', 'DataModel', 'ModelMapping'],
      collapsed: ['DataModel'],
    });
    expect(sanitizeSectionLayout(null)).toEqual({ order: ['DataModel', 'ModelMapping', 'Format'], collapsed: [] });
  });

  it('docks the collapsed sections below the open ones, each in the set order', () => {
    const order: SectionKind[] = ['Format', 'DataModel', 'ModelMapping'];
    const collapsed = new Set<SectionKind>(['Format', 'ModelMapping']);
    expect(arrangeSections(order, kind => collapsed.has(kind))).toEqual({
      open: ['DataModel'],
      docked: ['Format', 'ModelMapping'],
    });
  });

  it('drops a section before or after another', () => {
    const order: SectionKind[] = ['DataModel', 'ModelMapping', 'Format'];
    expect(dropSection(order, 'Format', 'DataModel', 'before')).toEqual(['Format', 'DataModel', 'ModelMapping']);
    expect(dropSection(order, 'DataModel', 'Format', 'after')).toEqual(['ModelMapping', 'Format', 'DataModel']);
    expect(dropSection(order, 'Format', 'Format', 'before')).toEqual(order);
  });

  it('moves a section past the neighbour it is shown with, not past a docked one', () => {
    // Mappings are docked: moving formats up puts them above the models.
    const order: SectionKind[] = ['DataModel', 'ModelMapping', 'Format'];
    const open: SectionKind[] = ['DataModel', 'Format'];
    expect(moveSection(order, 'Format', -1, open)).toEqual(['Format', 'DataModel', 'ModelMapping']);
    expect(moveSection(order, 'DataModel', 1, open)).toEqual(['ModelMapping', 'Format', 'DataModel']);
    // Already at the edge of its group.
    expect(moveSection(order, 'DataModel', -1, open)).toEqual(order);
    expect(moveSection(order, 'Format', 1, open)).toEqual(order);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { TreeNode } from '../state/store';
import {
  getConsultantBindingLabel,
  getConsultantDataTypeLabel,
  getConsultantFormatTypeLabel,
  getNodeDisplayName,
  isXmlNamespaceDeclaration,
} from './consultant-labels';

describe('consultant labels', () => {
  beforeEach(() => setLocale('en'));
  afterAll(() => setLocale('en'));

  describe('getConsultantBindingLabel', () => {
    it('reads a visibility switch bound to a literal as on or off', () => {
      expect(getConsultantBindingLabel({ bindingCategory: 'visibility', propertyName: 'Enabled', expressionAsString: 'false' })).toBe('Turned off');
      expect(getConsultantBindingLabel({ bindingCategory: 'visibility', propertyName: 'Enabled', expressionAsString: ' TRUE ' })).toBe('Turned on');
    });

    it('reads Disabled the other way round', () => {
      expect(getConsultantBindingLabel({ bindingCategory: 'visibility', propertyName: 'Disabled', expressionAsString: 'true' })).toBe('Turned off');
    });

    it('calls any other visibility expression a condition', () => {
      expect(getConsultantBindingLabel({ bindingCategory: 'visibility', propertyName: 'Visible', expressionAsString: 'model.Lines.Count > 0' })).toBe('Condition');
    });

    it('names the other categories, classifying when the category is missing', () => {
      expect(getConsultantBindingLabel({ bindingCategory: 'data', propertyName: '' })).toBe('Value');
      expect(getConsultantBindingLabel({ propertyName: 'Format' })).toBe('Formatting');
      expect(getConsultantBindingLabel({})).toBe('Value');
    });

    it('names the file properties instead of lumping them together', () => {
      expect(getConsultantBindingLabel({ bindingCategory: 'property', propertyName: 'FileName' })).toBe('File name');
      expect(getConsultantBindingLabel({ propertyName: 'FileLanguage' })).toBe('Language');
      expect(getConsultantBindingLabel({ propertyName: 'SomethingElse' })).toBe('Other properties');
      setLocale('cs');
      expect(getConsultantBindingLabel({ propertyName: 'FileCulture' })).toBe('Jazyková verze');
    });

    it('speaks Czech when the app does', () => {
      setLocale('cs');
      expect(getConsultantBindingLabel({ bindingCategory: 'visibility', propertyName: 'Enabled', expressionAsString: 'false' })).toBe('Vypnuto');
      expect(getConsultantBindingLabel({ propertyName: 'SomethingElse' })).toBe('Další vlastnosti');
    });
  });

  it('drops the structural Void data type and translates the rest', () => {
    expect(getConsultantDataTypeLabel('Void')).toBeUndefined();
    expect(getConsultantDataTypeLabel('Real')).toBe('Number');
    expect(getConsultantDataTypeLabel('Int64')).toBe('Int64');
  });

  it('humanizes a format element type it has no label for', () => {
    expect(getConsultantFormatTypeLabel('XMLAttribute')).toBe('Attribute');
    expect(getConsultantFormatTypeLabel('XMLFancyThing')).toBe('Fancy thing');
  });

  it('recognizes namespace and schema-location attributes only', () => {
    expect(isXmlNamespaceDeclaration({ elementType: 'XMLAttribute', name: 'xmlns' })).toBe(true);
    expect(isXmlNamespaceDeclaration({ elementType: 'XMLAttribute', name: 'xmlns:xs' })).toBe(true);
    expect(isXmlNamespaceDeclaration({ elementType: 'XMLAttribute', name: 'xs:schemaLocation' })).toBe(true);
    expect(isXmlNamespaceDeclaration({ elementType: 'XMLAttribute', name: 'verzeSW' })).toBe(false);
    expect(isXmlNamespaceDeclaration({ elementType: 'XMLElement', name: 'xmlns' })).toBe(false);
    expect(isXmlNamespaceDeclaration(undefined)).toBe(false);
  });

  describe('getNodeDisplayName', () => {
    const node = (partial: Partial<TreeNode>): TreeNode => ({ id: 'n', name: '', icon: '', type: 'section', ...partial });

    it('keeps the composed name in the technical view', () => {
      const mapping = node({ type: 'mapping', name: 'Tax mapping [TaxDeclarationModel]  (v274)', data: { name: 'Tax mapping' } });
      expect(getNodeDisplayName(mapping, true)).toBe('Tax mapping [TaxDeclarationModel]  (v274)');
    });

    it('drops the descriptor and revision from a mapping definition', () => {
      const mapping = node({ type: 'mapping', name: 'Tax mapping [TaxDeclarationModel]  (v274)', data: { name: 'Tax mapping' } });
      expect(getNodeDisplayName(mapping, false)).toBe('Tax mapping');
    });

    it('drops the expression from format binding rows', () => {
      const group = node({ type: 'formatBinding', name: 'verzeSW  ←  model.Version', data: { elementName: 'verzeSW' } });
      const binding = node({ type: 'formatBinding', name: 'Enabled  ←  false', data: { bindingCategory: 'visibility', propertyName: 'Enabled', expressionAsString: 'false' } });
      expect(getNodeDisplayName(group, false)).toBe('verzeSW');
      expect(getNodeDisplayName(binding, false)).toBe('Turned off');
    });

    it('names binding sections without the raw type', () => {
      expect(getNodeDisplayName(node({ name: 'XMLAttribute (3)', data: { bindingElementType: 'XMLAttribute', count: 3 } }), false)).toBe('Attribute (3)');
      expect(getNodeDisplayName(node({ name: 'Visibility (1)', data: { bindingCategory: 'visibility', count: 1 } }), false)).toBe('Visibility (1)');
    });

    it('leaves every other node alone', () => {
      expect(getNodeDisplayName(node({ type: 'container', name: 'Invoice' }), false)).toBe('Invoice');
    });
  });
});

/**
 * Load-time checks of the loaded configurations, surfaced in the status bar.
 */
import type { ERConfiguration, ERFormatContent } from '@er-visualizer/core';
import { locale } from '../i18n';
import { getMappingDefinitions } from './mapping-definitions';

export interface ConfigWarning {
  configIndex: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Optional tree node id to navigate to when clicked. */
  nodeId?: string;
}

/**
 * The token an expression starts with — what the unknown-datasource check
 * looks up. A unary sign or grouping parenthesis is not part of it:
 * `-(model.A + model.B)` starts at `model`, not at `-`.
 */
export function expressionRootToken(expr: string): string {
  return expr.trim().replace(/^[\s+\-(]+/, '').split(/[.([]/)[0].trim();
}

/**
 * Lightweight validator that walks the parsed configurations and reports
 * issues surfaced to the status bar. Intentionally fast: runs only at load.
 */
export function collectConfigurationWarnings(configurations: ERConfiguration[]): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];
  const hasModel = configurations.some(c => c.content.kind === 'DataModel');
  const hasMapping = configurations.some(c => c.content.kind === 'ModelMapping');
  const hasFormat = configurations.some(c => c.content.kind === 'Format');

  if (configurations.length > 0 && !hasModel) {
    warnings.push({
      configIndex: -1,
      severity: 'info',
      message: locale === 'cs'
        ? 'Pro plný drill-down načti i Data Model soubor.'
        : 'Load a Data Model file as well for a complete drill-down.',
    });
  }
  if (hasFormat && !hasMapping && !configurations.some(c => c.content.kind === 'Format' && (c.content as ERFormatContent).embeddedModelMappingVersions?.length > 0)) {
    warnings.push({
      configIndex: -1,
      severity: 'warning',
      message: locale === 'cs'
        ? 'Formát bez Model Mapping — výrazy nebude možné trasovat na zdrojové tabulky.'
        : 'Format loaded without a Model Mapping — expressions cannot be traced back to source tables.',
    });
  }

  configurations.forEach((config, ci) => {
    if (config.content.kind === 'Format') {
      const fc = config.content as ERFormatContent;
      const fmtMap = fc.formatMappingVersion.formatMapping;
      const dsNames = new Set<string>();
      const walkDs = (list: any[]) => {
        for (const d of list) {
          dsNames.add(d.name);
          if (d.children) walkDs(d.children);
        }
      };
      // Include datasources from embedded model mapping versions so that
      // format bindings referencing model-mapping datasources are not
      // incorrectly flagged as referencing unknown datasources. A version can
      // hold one definition per DataContainerDescriptor — scan them all.
      for (const embVersion of fc.embeddedModelMappingVersions) {
        for (const definition of getMappingDefinitions(embVersion)) walkDs(definition.datasources ?? []);
      }
      walkDs(fmtMap.datasources);
      // Count bindings whose expression root is unknown datasource.
      // Skip known ER expression functions, boolean/null literals, and operators.
      const erBuiltins = new Set([
        // Logical
        'and', 'or', 'not', 'if', 'case', 'true', 'false',
        // String
        'concatenate', 'format', 'replace', 'text', 'trim', 'upper', 'lower',
        'left', 'right', 'mid', 'len', 'padleft', 'translate', 'char',
        'numberformat', 'numeralstotext', 'getlabeltext', 'guidvalue',
        'qrcode', 'base64stringtocontainer', 'stringjoin',
        // Date/time
        'dateformat', 'datetimeformat', 'now', 'today', 'nulldate',
        'nulldatetime', 'sessiontoday', 'sessionnow', 'datevalue',
        'datetimevalue', 'adddays', 'dayofyear',
        // Math
        'abs', 'round', 'rounddown', 'roundup', 'power', 'mod', 'min', 'max',
        'int64value', 'intvalue', 'numbervalue', 'value', 'floor', 'ceiling',
        // List/collection
        'where', 'orderby', 'reverse', 'filter', 'first', 'firstornull',
        'count', 'sum', 'sumif', 'sumifs', 'countif', 'countifs', 'allitems',
        'allitemsquery', 'emptylist', 'list', 'listjoin', 'split', 'splitlist',
        'index', 'isempty', 'enumerate', 'enumerateinternal', 'distinct',
        'listoffields', 'lastornull', 'last', 'isemptyornull', 'addtolist',
        'nullcontainer', 'isnullorempty', 'fromexcel', 'getenumvaluebyname',
        'formatdata', 'datetimeformat', 'settext', 'numbervalue', 'valueinlarge',
        'isnull', 'iif', 'dayofweek', 'addmonths', 'addyears', 'month', 'year',
        'day', 'hour', 'minute', 'second', 'datevalue', 'currencyformat',
        'newguid', 'ordinal', 'dateformatlocalization', 'getcurrentcompany',
        'getcurrentuserid', 'getcurrentusername', 'getsessiontoday',
        // Conversion
        'convertcurrency', 'getdefaultcurrency', 'cn_getcurrency',
        // Other
        'null', 'isvalidchariso7064', 'valuein', 'valueinlarge',
        'contains', 'startswith', 'endswith',
      ]);
      let brokenRefs = 0;
      const brokenExpressions: string[] = [];
      for (const b of fmtMap.bindings) {
        // Validation bindings carry a display label ("Mapping validations"),
        // not an expression — their real conditions live in the nested rules.
        if (b.propertyName === 'Validation') continue;
        const expr = (b.expressionAsString ?? '').trim();
        if (!expr) continue;
        const rawRoot = expressionRootToken(expr);
        // Double-quoted string literals, numbers, parameters (@) and the model
        // root are never datasource references — check BEFORE stripping quotes.
        // (Single quotes wrap identifiers in ER: '$Company'.Name.)
        if (!rawRoot || /^["\d@]/.test(rawRoot) || rawRoot.toLowerCase() === 'model') continue;
        const root = rawRoot.replace(/'/g, '').trim();
        if (!root || root.toLowerCase() === 'model') continue;
        if (erBuiltins.has(root.toLowerCase())) continue;
        if (!dsNames.has(root)) {
          brokenRefs++;
          if (brokenExpressions.length < 30) brokenExpressions.push(expr);
        }
      }
      if (brokenRefs > 5) {
        const detail = brokenExpressions.map(e => `  • ${e}`).join('\n');
        warnings.push({
          configIndex: ci,
          severity: 'warning',
          message: locale === 'cs'
            ? `Formát "${config.solutionVersion.solution.name}" obsahuje ${brokenRefs} výrazů odkazujících na neznámý datový zdroj.\n${detail}${brokenRefs > 30 ? `\n  … a ${brokenRefs - 30} dalších` : ''}`
            : `Format "${config.solutionVersion.solution.name}" contains ${brokenRefs} expressions that reference an unknown data source.\n${detail}${brokenRefs > 30 ? `\n  … and ${brokenRefs - 30} more` : ''}`,
        });
      }
    }
  });

  return warnings;
}

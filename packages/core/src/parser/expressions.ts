import type { ERExpression } from '../types/expressions.js';
import { getAttr, getContents, getContentsArray, orderedChildren } from './xml-document.js';
import type { XmlNode } from './xml-document.js';

// ─── Expression Parser ───

export function parseExpression(exprContainer: XmlNode | undefined): ERExpression | undefined {
  if (!exprContainer) return undefined;

  // The Expression element wraps the actual expression node
  // Find the first child element that is an expression type
  for (const [key, val] of orderedChildren(exprContainer)) {
    const parsed = parseExpressionNode(key, val);
    if (parsed) return parsed;
  }

  return undefined;
}

function parseExpressionChildren(node: XmlNode): ERExpression[] {
  const children: ERExpression[] = [];
  const contentsNode = getContents(node);
  if (!contentsNode) return children;

  for (const [key, item] of orderedChildren(contentsNode)) {
    const parsed = parseExpressionNode(key, item);
    if (parsed) children.push(parsed);
  }

  return children;
}

function defaultConstant(dataType: 'String' | 'Int' | 'Real' | 'Boolean' | 'DateNull' = 'String'): ERExpression {
  if (dataType === 'Boolean') return { kind: 'Constant', dataType, value: false };
  if (dataType === 'DateNull') return { kind: 'Constant', dataType, value: null };
  if (dataType === 'Real' || dataType === 'Int') return { kind: 'Constant', dataType, value: 0 };
  return { kind: 'Constant', dataType, value: '' };
}

function parseExpressionNode(elementName: string, node: any): ERExpression | undefined {
  // An attribute-less element such as `<ERExpressionDateSessionToday/>` parses
  // to '' — a real node, not a missing one.
  if (node == null) return undefined;

  // Item values
  if (elementName.match(/^ERExpression(String|Real|Int|Int64|Boolean|Enum|Date|DateTime|List|Container|DataContainer)ItemValue$/)) {
    const typeMatch = elementName.match(/ERExpression(\w+)ItemValue/);
    const dataTypeMap: Record<string, string> = {
      String: 'String', Real: 'Real', Int: 'Int', Boolean: 'Boolean',
      Int64: 'Int', Enum: 'Enum', Date: 'Date', DateTime: 'Date',
      List: 'List', Container: 'Container', DataContainer: 'Container',
    };
    return {
      kind: 'ItemValue',
      dataType: (dataTypeMap[typeMatch?.[1] ?? ''] ?? 'String') as any,
      itemPath: getAttr(node, 'ItemPath') ?? '',
    };
  }

  // Constants
  if (elementName === 'ERExpressionStringConstant') {
    return { kind: 'Constant', dataType: 'String', value: getAttr(node, 'Value') ?? '' };
  }
  if (elementName === 'ERExpressionIntConstant') {
    return { kind: 'Constant', dataType: 'Int', value: parseInt(getAttr(node, 'Value') ?? '0', 10) };
  }
  if (elementName === 'ERExpressionRealConstant') {
    return { kind: 'Constant', dataType: 'Real', value: parseFloat(getAttr(node, 'Value') ?? '0') };
  }
  if (elementName === 'ERExpressionBooleanConstant') {
    return { kind: 'Constant', dataType: 'Boolean', value: getAttr(node, 'Value') === '1' };
  }
  if (elementName === 'ERExpressionDateNull') {
    return { kind: 'Constant', dataType: 'DateNull', value: null };
  }

  // IF
  if (elementName === 'ERExpressionGenericIf') {
    return {
      kind: 'If',
      condition: parseExpression(node['Condition']) ?? { kind: 'Constant', dataType: 'Boolean', value: true },
      trueValue: parseExpression(node['TrueValue']) ?? { kind: 'Constant', dataType: 'String', value: '' },
      falseValue: parseExpression(node['FalseValue']) ?? { kind: 'Constant', dataType: 'String', value: '' },
    };
  }

  // CASE
  if (elementName === 'ERExpressionGenericCase') {
    const children = parseExpressionChildren(node);
    const expression = children[0] ?? defaultConstant();
    const remainder = children.slice(1);
    const hasDefault = remainder.length % 2 === 1;
    const caseValues = hasDefault ? remainder.slice(0, -1) : remainder;
    const cases: { when: ERExpression; then: ERExpression }[] = [];

    for (let i = 0; i < caseValues.length; i += 2) {
      const when = caseValues[i];
      const then = caseValues[i + 1];
      if (when && then) {
        cases.push({ when, then });
      }
    }

    return {
      kind: 'Case',
      expression,
      cases,
      defaultValue: hasDefault ? remainder[remainder.length - 1] : undefined,
    };
  }

  // Binary arithmetic
  if (elementName === 'ERExpressionNumericMultiply') {
    return {
      kind: 'BinaryOp', operator: 'Multiply',
      left: parseExpression(node['Multiplicand']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
      right: parseExpression(node['Multiplier']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
    };
  }
  if (elementName === 'ERExpressionNumericAdd') {
    return {
      kind: 'BinaryOp', operator: 'Add',
      left: parseExpression(node['FirstAddend']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
      right: parseExpression(node['SecondAddend']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
    };
  }
  if (elementName === 'ERExpressionNumericSubtract') {
    return {
      kind: 'BinaryOp', operator: 'Subtract',
      left: parseExpression(node['Minuend']) ?? defaultConstant('Int'),
      right: parseExpression(node['Subtraend']) ?? defaultConstant('Int'),
    };
  }
  if (elementName === 'ERExpressionNumericDivide') {
    return {
      kind: 'BinaryOp', operator: 'Divide',
      left: parseExpression(node['Dividend']) ?? defaultConstant('Int'),
      right: parseExpression(node['Divisor']) ?? defaultConstant('Int'),
    };
  }

  // Logical
  if (elementName === 'ERExpressionAnd') {
    const children = parseExpressionChildren(node);
    if (children.length === 0) return undefined;
    return children.reduce((acc, cur) => ({
      kind: 'BinaryOp', operator: 'And', left: acc, right: cur,
    }));
  }

  if (elementName === 'ERExpressionOr') {
    const children = parseExpressionChildren(node);
    if (children.length === 0) return undefined;
    return children.reduce((acc, cur) => ({
      kind: 'BinaryOp', operator: 'Or', left: acc, right: cur,
    }));
  }

  if (elementName === 'ERExpressionNot') {
    return {
      kind: 'UnaryOp', operator: 'Not',
      operand: parseExpression(node['Input']) ?? defaultConstant('Boolean'),
    };
  }

  if (elementName === 'ERExpressionRealAbs') {
    return {
      kind: 'UnaryOp', operator: 'Abs',
      operand: parseExpression(node['Input']) ?? defaultConstant('Real'),
    };
  }

  if (elementName === 'ERExpressionNumericUnarySubtract') {
    return {
      kind: 'UnaryOp', operator: 'Negate',
      operand: parseExpression(node['Expression']) ?? defaultConstant('Int'),
    };
  }

  // Comparisons
  const compMap: Record<string, { op: string; dt: string }> = {
    ERExpressionBooleanEquals: { op: 'Equals', dt: 'Boolean' },
    ERExpressionStringEquals: { op: 'Equals', dt: 'String' },
    ERExpressionStringNotEquals: { op: 'NotEquals', dt: 'String' },
    ERExpressionDateEquals: { op: 'Equals', dt: 'Date' },
    ERExpressionDateNotEquals: { op: 'NotEquals', dt: 'Date' },
    ERExpressionDateGreaterOrEqual: { op: 'GreaterOrEqual', dt: 'Date' },
    ERExpressionDateLess: { op: 'LessThan', dt: 'Date' },
    ERExpressionDateLessrOrEqual: { op: 'LessOrEqual', dt: 'Date' },
    ERExpressionDateTimeGreaterOrEqual: { op: 'GreaterOrEqual', dt: 'DateTime' },
    ERExpressionDateTimeLessOrEqual: { op: 'LessOrEqual', dt: 'DateTime' },
    ERExpressionEnumEquals: { op: 'Equals', dt: 'Enum' },
    ERExpressionEnumNotEquals: { op: 'NotEquals', dt: 'Enum' },
    ERExpressionNumericEquals: { op: 'Equals', dt: 'Numeric' },
    ERExpressionNumericNotEquals: { op: 'NotEquals', dt: 'Numeric' },
    ERExpressionNumericGreater: { op: 'GreaterThan', dt: 'Numeric' },
    ERExpressionNumericGreaterOrEqual: { op: 'GreaterOrEqual', dt: 'Numeric' },
    ERExpressionNumericLesser: { op: 'LessThan', dt: 'Numeric' },
    ERExpressionNumericLesserOrEqual: { op: 'LessOrEqual', dt: 'Numeric' },
  };
  if (compMap[elementName]) {
    const { op, dt } = compMap[elementName];
    return {
      kind: 'Comparison',
      operator: op as any,
      dataType: dt,
      left: parseExpression(node['FirstExpression']) ?? defaultConstant(),
      right: parseExpression(node['SecondExpression']) ?? defaultConstant(),
    };
  }

  // List operations
  if (elementName === 'ERExpressionListIsEmpty') {
    return {
      kind: 'ListOp', operator: 'IsEmpty',
      operand: parseExpression(node['Input']) ?? { kind: 'Constant', dataType: 'String', value: '' },
    };
  }
  if (elementName === 'ERExpressionListAllItems') {
    return {
      kind: 'ListOp', operator: 'AllItems',
      operand: parseExpression(node['Input']) ?? defaultConstant(),
    };
  }
  if (elementName === 'ERExpressionListWhere' || elementName === 'ERExpressionListFilter') {
    return {
      kind: 'ListOp', operator: elementName === 'ERExpressionListWhere' ? 'Where' : 'Filter',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
      arguments: [parseExpression(node['Condition']) ?? defaultConstant('Boolean')],
    };
  }
  if (elementName === 'ERExpressionListOrderBy') {
    return {
      kind: 'ListOp', operator: 'OrderBy',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
      arguments: parseExpressionChildren(node),
    };
  }
  if (elementName === 'ERExpressionListCount' || elementName === 'ERExpressionListCounter') {
    return {
      kind: 'ListOp', operator: 'Count',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
    };
  }
  if (elementName === 'ERExpressionListFirstOrNull' || elementName === 'ERExpressionListFirst') {
    return {
      kind: 'ListOp', operator: 'FirstOrNull',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
    };
  }

  // String operations
  if (elementName === 'ERExpressionStringFormat') {
    const children = parseExpressionChildren(node);
    return {
      kind: 'Format',
      formatString: children[0] ?? defaultConstant(),
      arguments: children.slice(1),
    };
  }

  if (elementName === 'ERExpressionStringLabel') {
    return {
      kind: 'StringOp', operator: 'Label',
      arguments: [parseExpression(node['LabelId']) ?? { kind: 'Constant', dataType: 'String', value: '' }],
    };
  }
  if (elementName === 'ERExpressionStringMid') {
    return {
      kind: 'StringOp', operator: 'Mid',
      arguments: [
        parseExpression(node['Input']) ?? defaultConstant(),
        parseExpression(node['Start']) ?? defaultConstant('Int'),
        parseExpression(node['Length']) ?? defaultConstant('Int'),
      ],
    };
  }
  if (elementName === 'ERExpressionStringLen' || elementName === 'ERExpressionSTringLen') {
    return {
      kind: 'StringOp', operator: 'Len',
      arguments: [parseExpression(node['Input']) ?? defaultConstant()],
    };
  }
  if (elementName === 'ERExpressionStringReplace') {
    return {
      kind: 'StringOp', operator: 'Replace',
      arguments: [
        parseExpression(node['Input']) ?? defaultConstant(),
        parseExpression(node['Pattern'] ?? node['OldString']) ?? defaultConstant(),
        parseExpression(node['Replacement'] ?? node['NewString']) ?? defaultConstant(),
      ],
    };
  }
  if (elementName === 'ERExpressionStringConcatenate') {
    return {
      kind: 'StringOp', operator: 'Concatenate',
      arguments: parseExpressionChildren(node),
    };
  }
  if (elementName === 'ERExpressionStringTrim') {
    return {
      kind: 'StringOp', operator: 'Trim',
      arguments: [parseExpression(node['Input']) ?? defaultConstant()],
    };
  }

  // Date operations
  if (elementName === 'ERExpressionDateFormat') {
    return {
      kind: 'DateOp', operator: 'DateFormat',
      arguments: [
        parseExpression(node['Date']) ?? defaultConstant('DateNull'),
        parseExpression(node['Format']) ?? defaultConstant(),
      ],
    };
  }
  if (elementName === 'ERExpressionDateSessionToday') {
    return { kind: 'DateOp', operator: 'SessionToday', arguments: [] };
  }
  if (elementName === 'ERExpressionDateValue') {
    return {
      kind: 'DateOp', operator: 'DateValue',
      arguments: [parseExpression(node['Input']) ?? defaultConstant()],
    };
  }
  if (elementName === 'ERExpressionNow') {
    return { kind: 'DateOp', operator: 'Now', arguments: [] };
  }

  // Adapters (type wrappers)
  if (/^ERExpression(?:Boolean|Int|Int64|Real|String|Enum|List|DataContainer)Adapter$/.test(elementName)) {
    return parseExpression(node['Expression']);
  }

  // Generic call
  if (elementName === 'ERExpressionGenericCall') {
    return {
      kind: 'Call',
      functionName: getAttr(node, 'FunctionName') ?? getAttr(node, 'ItemPath') ?? elementName,
      arguments: parseExpressionChildren(node),
    };
  }

  if (/^ERExpression(Get[A-Za-z0-9]+|Transformation|RealRound|RealRoundAmount|RealToInt|RealToInt64|RealValueSeparatorsSet|ListStringJoin|ListJoin|ListSplitString|ListSplitStringByDelimiter|ListDistinct|ListReverse|ListOfFields|ListIndex|ListFirstList|ListEmpty|EmptyRecord|TableName2Id|DateToDateTime)$/.test(elementName)) {
    return {
      kind: 'Call',
      functionName: elementName.replace(/^ERExpression/, ''),
      arguments: parseExpressionChildren(node),
    };
  }

  // Validation conditions
  if (elementName === 'ERExpressionValidationConditions') {
    const conditions = getContentsArray(node, 'ERExpressionValidationCondition').map(
      (c: any): { id: string; condition: ERExpression; message: ERExpression } => ({
        id: getAttr(c, 'ID.') ?? '',
        condition: parseExpression(c['ConditionHost']?.['ERExpressionBooleanHost']?.['Expression']) ??
          { kind: 'Constant', dataType: 'Boolean', value: true },
        message: parseExpression(c['MessageHost']?.['ERExpressionStringHost']?.['Expression']) ??
          { kind: 'Constant', dataType: 'String', value: '' },
      }),
    );
    return { kind: 'ValidationConditions', conditions };
  }

  // Fallback: Generic expression node
  const attrs: Record<string, string> = {};
  const children: ERExpression[] = [];

  if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('@_')) attrs[k.slice(2)] = String(v);
    }
    for (const [k, item] of orderedChildren(node)) {
      const parsed = parseExpressionNode(k, item);
      if (parsed) children.push(parsed);
    }
  }

  return {
    kind: 'Generic',
    xmlElementName: elementName,
    expressionAsString: getAttr(node, 'ExpressionAsString') ?? '',
    children,
    attributes: attrs,
  };
}

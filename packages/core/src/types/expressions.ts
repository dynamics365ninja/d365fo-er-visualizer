// Expression AST types — covers all ER formula expression XML nodes

export type ERExpression =
  | ERExprItemValue
  | ERExprConstant
  | ERExprIf
  | ERExprCase
  | ERExprCall
  | ERExprBinaryOp
  | ERExprUnaryOp
  | ERExprComparison
  | ERExprListOp
  | ERExprFormat
  | ERExprDateOp
  | ERExprStringOp
  | ERExprValidationConditions
  | ERExprGeneric;

export interface ERExprItemValue {
  kind: 'ItemValue';
  dataType: 'String' | 'Real' | 'Int' | 'Boolean' | 'Enum' | 'Date' | 'List' | 'Container';
  itemPath: string;
}

export interface ERExprConstant {
  kind: 'Constant';
  dataType: 'String' | 'Int' | 'Real' | 'Boolean' | 'DateNull';
  value: string | number | boolean | null;
}

export interface ERExprIf {
  kind: 'If';
  condition: ERExpression;
  trueValue: ERExpression;
  falseValue: ERExpression;
}

export interface ERExprCase {
  kind: 'Case';
  expression: ERExpression;
  cases: { when: ERExpression; then: ERExpression }[];
  defaultValue?: ERExpression;
}

export interface ERExprCall {
  kind: 'Call';
  functionName: string;
  arguments: ERExpression[];
}

export interface ERExprBinaryOp {
  kind: 'BinaryOp';
  operator: 'Add' | 'Subtract' | 'Multiply' | 'Divide' | 'And' | 'Or';
  left: ERExpression;
  right: ERExpression;
}

export interface ERExprUnaryOp {
  kind: 'UnaryOp';
  operator: 'Not' | 'Abs' | 'Negate';
  operand: ERExpression;
}

export interface ERExprComparison {
  kind: 'Comparison';
  operator: 'Equals' | 'NotEquals' | 'GreaterThan' | 'LessThan' | 'GreaterOrEqual' | 'LessOrEqual';
  dataType: string;
  left: ERExpression;
  right: ERExpression;
}

export interface ERExprListOp {
  kind: 'ListOp';
  operator: 'IsEmpty' | 'AllItems' | 'Filter' | 'Where' | 'OrderBy' | 'Count' | 'FirstOrNull';
  operand: ERExpression;
  arguments?: ERExpression[];
}

export interface ERExprFormat {
  kind: 'Format';
  formatString: ERExpression;
  arguments: ERExpression[];
}

export interface ERExprDateOp {
  kind: 'DateOp';
  operator: 'DateFormat' | 'SessionToday' | 'DateValue' | 'Now';
  arguments: ERExpression[];
}

export interface ERExprStringOp {
  kind: 'StringOp';
  operator: 'Mid' | 'Len' | 'Replace' | 'Trim' | 'Concatenate' | 'Label';
  arguments: ERExpression[];
}

export interface ERExprValidationConditions {
  kind: 'ValidationConditions';
  conditions: ERValidationCondition[];
}

export interface ERValidationCondition {
  id: string;
  condition: ERExpression;
  message: ERExpression;
}

export interface ERExprGeneric {
  kind: 'Generic';
  xmlElementName: string;
  expressionAsString: string;
  children: ERExpression[];
  attributes: Record<string, string>;
}

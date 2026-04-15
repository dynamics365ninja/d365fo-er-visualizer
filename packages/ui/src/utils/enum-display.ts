export type EnumSourceKind = 'Ax' | 'DataModel' | 'Format';

export function getEnumSourceKind(enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null): EnumSourceKind {
  if (enumInfo?.sourceKind === 'DataModel' || enumInfo?.sourceKind === 'Format' || enumInfo?.sourceKind === 'Ax') {
    return enumInfo.sourceKind;
  }

  return enumInfo?.isModelEnum ? 'DataModel' : 'Ax';
}

export function getEnumTypeLabel(enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null): string {
  switch (getEnumSourceKind(enumInfo)) {
    case 'DataModel':
      return 'Data model Enum';
    case 'Format':
      return 'Format enum';
    default:
      return 'Ax Enum';
  }
}

export function formatEnumDisplayName(
  enumName: string,
  enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null,
): string {
  return `${enumName} (${getEnumTypeLabel(enumInfo)})`;
}
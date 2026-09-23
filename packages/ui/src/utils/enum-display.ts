import { getLocale, type Locale } from '../i18n';

export type EnumSourceKind = 'Ax' | 'DataModel' | 'Format';

export function getEnumSourceKind(enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null): EnumSourceKind {
  if (enumInfo?.sourceKind === 'DataModel' || enumInfo?.sourceKind === 'Format' || enumInfo?.sourceKind === 'Ax') {
    return enumInfo.sourceKind;
  }

  return enumInfo?.isModelEnum ? 'DataModel' : 'Ax';
}

const enumTypeLabels: Record<Locale, Record<EnumSourceKind, string>> = {
  cs: { Ax: 'Výčet AX', DataModel: 'Výčet datového modelu', Format: 'Výčet formátu' },
  en: { Ax: 'Ax Enum', DataModel: 'Data model Enum', Format: 'Format enum' },
};

export function getEnumTypeLabel(
  enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null,
  locale: Locale = getLocale(),
): string {
  return enumTypeLabels[locale][getEnumSourceKind(enumInfo)];
}

export function formatEnumDisplayName(
  enumName: string,
  enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null,
  locale: Locale = getLocale(),
): string {
  return `${enumName} (${getEnumTypeLabel(enumInfo, locale)})`;
}

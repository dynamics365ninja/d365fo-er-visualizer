import { getLocale, getTranslations, type Locale } from '../i18n';

export type EnumSourceKind = 'Ax' | 'DataModel' | 'Format';

export function getEnumSourceKind(enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null): EnumSourceKind {
  if (enumInfo?.sourceKind === 'DataModel' || enumInfo?.sourceKind === 'Format' || enumInfo?.sourceKind === 'Ax') {
    return enumInfo.sourceKind;
  }

  return enumInfo?.isModelEnum ? 'DataModel' : 'Ax';
}

export function getEnumTypeLabel(
  enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null,
  locale: Locale = getLocale(),
): string {
  return getTranslations(locale).enumTypeLabels[getEnumSourceKind(enumInfo)];
}

export function formatEnumDisplayName(
  enumName: string,
  enumInfo?: { sourceKind?: string; isModelEnum?: boolean } | null,
  locale: Locale = getLocale(),
): string {
  return `${enumName} (${getEnumTypeLabel(enumInfo, locale)})`;
}

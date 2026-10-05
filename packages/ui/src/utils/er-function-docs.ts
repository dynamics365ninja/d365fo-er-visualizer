/**
 * Links ER built-in functions to their Microsoft Learn reference pages.
 * Article slugs follow `er-functions-<category>-<name>`; the list mirrors
 * the articles listed in the ER function categories on Learn.
 */
import { getTranslations, type Locale } from '../i18n';

const LEARN_BASE = 'https://learn.microsoft.com';
const LEARN_PATH = 'dynamics365/fin-ops-core/dev-itpro/analytics';

/** Upper-case function name → article slug (without the `er-functions-` prefix). */
const ER_FUNCTION_DOC_SLUGS: Record<string, string> = {
  BASE64STRINGTOCONTAINER: 'container-base64stringtocontainer',
  INT64VALUE: 'conversion-int64value',
  INTVALUE: 'conversion-intvalue',
  NUMBERVALUE: 'conversion-numbervalue',
  VALUE: 'conversion-value',
  COLLECTEDLIST: 'datacollection-collectedlist',
  COUNTIF: 'datacollection-countif',
  COUNTIFS: 'datacollection-countifs',
  FORMATELEMENTNAME: 'datacollection-formatelementname',
  SUMIF: 'datacollection-sumif',
  SUMIFS: 'datacollection-sumifs',
  ADDDAYS: 'datetime-adddays',
  CHANGETIMEZONE: 'datetime-changetimezone',
  DATEFORMAT: 'datetime-dateformat',
  DATETIMEFORMAT: 'datetime-datetimeformat',
  DATETIMEVALUE: 'datetime-datetimevalue',
  DATETODATETIME: 'datetime-datetodatetime',
  DATEVALUE: 'datetime-datevalue',
  DAYOFYEAR: 'datetime-dayofyear',
  DAYS: 'datetime-days',
  NOW: 'datetime-now',
  NULLDATE: 'datetime-nulldate',
  NULLDATETIME: 'datetime-nulldatetime',
  SESSIONNOW: 'datetime-sessionnow',
  SESSIONTODAY: 'datetime-sessiontoday',
  TODAY: 'datetime-today',
  WEEKNUM: 'datetime-weeknum',
  ALLITEMS: 'list-allitems',
  ALLITEMSQUERY: 'list-allitemsquery',
  COUNT: 'list-count',
  EMPTYLIST: 'list-emptylist',
  ENUMERATE: 'list-enumerate',
  FILTER: 'list-filter',
  FIRST: 'list-first',
  FIRSTORNULL: 'list-firstornull',
  INDEX: 'list-index',
  ISEMPTY: 'list-isempty',
  LIST: 'list-list',
  LISTDISTINCT: 'list-listdistinct',
  LISTJOIN: 'list-listjoin',
  LISTOFFIELDS: 'list-listoffields',
  LISTOFFIRSTITEM: 'list-listoffirstitem',
  ORDERBY: 'list-orderby',
  REPEAT: 'list-repeat',
  REVERSE: 'list-reverse',
  SPLIT: 'list-split',
  SPLITLIST: 'list-splitlist',
  SPLITLISTBYLIMIT: 'list-splitlistbylimit',
  STRINGJOIN: 'list-stringjoin',
  WHERE: 'list-where',
  AND: 'logical-and',
  CASE: 'logical-case',
  CONTAINS: 'logical-contains',
  ENDSWITH: 'logical-endswith',
  IF: 'logical-if',
  NOT: 'logical-not',
  OR: 'logical-or',
  STARTSWITH: 'logical-startswith',
  VALUEIN: 'logical-valuein',
  VALUEINLARGE: 'logical-valueinlarge',
  ABS: 'mathematical-abs',
  DIV: 'mathematical-div',
  MOD: 'mathematical-mod',
  POWER: 'mathematical-power',
  ROUND: 'mathematical-round',
  ROUNDDOWN: 'mathematical-rounddown',
  ROUNDUP: 'mathematical-roundup',
  CHBANKMODE10: 'other-chbankmode10',
  CNGBTADDITIONALDIMENSIONID: 'other-cngbtadditionaldimensionid',
  CONVERTCURRENCY: 'other-convertcurrency',
  CURCREDREF: 'other-curcredref',
  FABALANCE: 'other-fabalance',
  FASUM: 'other-fasum',
  GETCURRENTCOMPANY: 'other-getcurrentcompany',
  ISOCREDREF: 'other-isocredref',
  ISVALIDCHARISO7064: 'other-isvalidchariso7064',
  MOD97: 'other-mod97',
  NUMSEQVALUE: 'other-numseqvalue',
  ROUNDAMOUNT: 'other-roundamount',
  TABLENAME2ID: 'other-tablename2id',
  TAXUNITCONVERSION: 'other-taxunitconversion',
  EMPTYRECORD: 'record-emptyrecord',
  NULLCONTAINER: 'record-nullcontainer',
  CHAR: 'text-char',
  CONCATENATE: 'text-concatenate',
  FORMAT: 'text-format',
  GETENUMVALUEBYNAME: 'text-getenumvaluebyname',
  GETLABELTEXT: 'text-getlabeltext',
  GUIDVALUE: 'text-guidvalue',
  JSONVALUE: 'text-jsonvalue',
  LEFT: 'text-left',
  LEN: 'text-len',
  LOWER: 'text-lower',
  MID: 'text-mid',
  NEWGUID: 'text-newguid',
  NUMBERFORMAT: 'text-numberformat',
  NUMERALSTOTEXT: 'text-numeralstotext',
  PADLEFT: 'text-padleft',
  QRCODE: 'text-qrcode',
  REPLACE: 'text-replace',
  RIGHT: 'text-right',
  TEXT: 'text-text',
  TRANSLATE: 'text-translate',
  TRIM: 'text-trim',
  UPPER: 'text-upper',
};

function learnUrl(slug: string, locale: Locale): string {
  return `${LEARN_BASE}/${getTranslations(locale).learnCulture}/${LEARN_PATH}/${slug}`;
}

/** The Learn page describing `name`, or `undefined` when Learn has none. */
export function erFunctionDocUrl(name: string, locale: Locale = 'en'): string | undefined {
  const slug = ER_FUNCTION_DOC_SLUGS[name.toUpperCase()];
  return slug ? learnUrl(`er-functions-${slug}`, locale) : undefined;
}

export function isDocumentedErFunction(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ER_FUNCTION_DOC_SLUGS, name.toUpperCase());
}

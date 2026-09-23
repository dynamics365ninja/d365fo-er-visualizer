/**
 * Styles shared by the F&O connector panel and its sub-components.
 */

import { makeStyles, tokens, shorthands } from '@fluentui/react-components';

export const useFnoPanelStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    width: '100%',
    maxWidth: '1680px',
    marginLeft: 'auto',
    marginRight: 'auto',
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
    boxSizing: 'border-box',
  },

  // ── Page header ──────────────────────────────────────────────
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  pageHeaderIcon: {
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForegroundOnBrand,
    flexShrink: 0,
  },

  // ── Card wrapper ─────────────────────────────────────────────
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalXS,
  },
  cardHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  cardIcon: {
    color: tokens.colorBrandForeground1,
  },

  // ── Profile editor form ──────────────────────────────────────
  // Stacked full-width rows: every label, input and hint lines up on the same
  // left edge and every input is exactly as wide as the next one. A two-column
  // grid made the short "name" and the long "URL" look mismatched.
  formStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    width: '100%',
  },
  formInput: {
    width: '100%',
  },
  dialogSurface: {
    maxWidth: '540px',
  },
  redirectHintRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    flexWrap: 'wrap',
  },
  redirectHintValue: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    padding: `2px ${tokens.spacingHorizontalXS}`,
    wordBreak: 'break-all',
  },
  warningBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.border('1px', 'solid', tokens.colorPaletteRedBorder1),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteRedBackground1,
  },

  // ── Profile list ─────────────────────────────────────────────
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  // Fixed three-track grid so the avatar, the text block and the action
  // buttons keep the same x-position in every row no matter how long the
  // profile name or URL is.
  profileRow: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    transition: 'background-color 0.1s, border-color 0.1s',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    // Narrow windows: Connect + edit + delete would squeeze the name and URL
    // down to a couple of characters, so the buttons drop to their own line.
    '@media (max-width: 560px)': {
      gridTemplateColumns: 'auto minmax(0, 1fr)',
      rowGap: tokens.spacingVerticalXS,
    },
  },
  profileRowActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
  },
  profileAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: '700',
    flexShrink: 0,
    textTransform: 'uppercase',
  },
  profileAvatarActive: {
    backgroundColor: tokens.colorBrandBackgroundPressed,
  },
  profileMeta: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  // Long environment URLs must not push the action buttons out of alignment.
  profileLine: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  profileActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flexShrink: 0,
    '@media (max-width: 560px)': {
      gridColumn: '1 / -1',
      justifyContent: 'flex-end',
    },
  },
  profileEmptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalXS,
    textAlign: 'center',
    ...shorthands.padding(tokens.spacingVerticalXXL, tokens.spacingHorizontalL),
    ...shorthands.border('1px', 'dashed', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },

  // ── Connection status (inside the selected environment row) ───
  // It used to be a separate bar under the list, which repeated the selected
  // environment's name, URL and a Connect button verbatim. Hanging the status
  // off the row it describes means an environment is named exactly once.
  connStatusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    // Centre the dot on the cap height of the caption line beside it.
    marginTop: '4px',
  },
  connStatusDotConnected: { backgroundColor: tokens.colorPaletteGreenForeground1 },
  connStatusDotConnecting: { backgroundColor: tokens.colorPaletteYellowForeground1 },
  connStatusDotDisconnected: { backgroundColor: tokens.colorNeutralForeground3 },
  connStatusDotError: { backgroundColor: tokens.colorPaletteRedForeground1 },
  // Top-aligned: a wrapped sign-in error must keep its dot next to the first
  // line, not floating in the middle of the paragraph.
  profileStatusRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    marginTop: '3px',
  },
  // Sign-in errors are whole sentences — they wrap instead of being clipped
  // on one line like the name and URL above them.
  profileStatusText: {
    minWidth: 0,
    overflowWrap: 'break-word',
  },
  profileConnectBtn: {
    marginRight: tokens.spacingHorizontalXXS,
  },

  // ── Browser (two-column) ──────────────────────────────────────
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 380px) minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    minHeight: '480px',
    width: '100%',
    '@media (max-width: 860px)': {
      gridTemplateColumns: '1fr',
    },
  },
  // Browsing an environment means scrolling long lists, so the boxes grow with
  // the window instead of stopping at a fixed 660px on a tall screen.
  listBox: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: 'hidden',
    minHeight: '480px',
    maxHeight: 'max(480px, calc(100vh - 260px))',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
    minHeight: '44px',
  },
  listHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  listSearchBar: {
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalM),
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    flexShrink: 0,
  },
  // Input above, cross-model search button below: side by side the button
  // would squeeze the box to a few characters in the narrow left column.
  listSearchRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  // Progress / result count of a cross-model search, under the search box.
  searchNote: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXS,
    minWidth: 0,
  },
  searchNoteText: {
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Owning model of a search hit — the row alone would not say where it lives.
  resultOwner: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '2px',
    color: tokens.colorNeutralForeground3,
    backgroundColor: 'transparent',
    ...shorthands.border('0'),
    ...shorthands.padding('0'),
    font: 'inherit',
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    maxWidth: '100%',
    minWidth: 0,
    textAlign: 'left',
    ':hover': {
      color: tokens.colorBrandForeground1,
      textDecorationLine: 'underline',
    },
  },
  resultOwnerName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  listScroll: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  listItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorBrandStroke1,
  },
  listItemContent: {
    flex: 1,
    minWidth: 0,
  },
  listItemDead: {
    opacity: 0.5,
  },
  listItemChild: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  listItemChildActive: {
    backgroundColor: tokens.colorBrandBackground2,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorBrandStroke1,
  },
  expandBtn: {
    flexShrink: 0,
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: tokens.colorNeutralForeground3,
    borderRadius: tokens.borderRadiusSmall,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      color: tokens.colorNeutralForeground2,
    },
    transition: 'color 0.1s',
  },
  expandBtnPlaceholder: {
    flexShrink: 0,
    width: '20px',
    height: '20px',
  },

  // ── Component type badge ──────────────────────────────────────
  typeBadge: {
    flexShrink: 0,
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },

  // ── Breadcrumb ────────────────────────────────────────────────
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    minWidth: 0,
    overflow: 'hidden',
  },
  breadcrumbSep: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    fontSize: '12px',
  },
  breadcrumbItem: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },

  // ── Empty states ──────────────────────────────────────────────
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalS,
    ...shorthands.padding(tokens.spacingVerticalXXL, tokens.spacingHorizontalM),
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
  emptyStateRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'stretch',
    width: '100%',
    maxWidth: '340px',
  },

  // ── Footer ────────────────────────────────────────────────────
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalL),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
  },
  footerStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
    flex: 1,
  },
  row: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});

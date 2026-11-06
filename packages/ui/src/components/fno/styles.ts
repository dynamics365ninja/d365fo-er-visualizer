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
  // Ledger tile: a soft indigo square with the accent glyph, not a filled block.
  pageHeaderIcon: {
    width: '40px',
    height: '40px',
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-accent-soft)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--er-accent)',
    flexShrink: 0,
  },
  pageTitle: {
    '& .fui-Subtitle2': {
      fontSize: '18px',
      lineHeight: '24px',
      fontWeight: 600,
      letterSpacing: '-0.3px',
    },
  },

  // ── Card wrapper ─────────────────────────────────────────────
  // A Ledger panel: white card, a 48px header row over a hairline, the body
  // inset 16px below it.
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    ...shorthands.padding('0', '0', '16px'),
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    borderRadius: 'var(--er-radius-xl)',
    backgroundColor: 'var(--er-surface)',
    boxShadow: 'var(--er-shadow-1)',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    minHeight: '48px',
    boxSizing: 'border-box',
    ...shorthands.padding('8px', '12px', '8px', '16px'),
    borderBottom: '1px solid var(--er-border)',
    '& .fui-Body1Strong': {
      fontSize: 'var(--er-text-lg)',
      letterSpacing: '-0.2px',
    },
    // Counts are quiet pills.
    '& .fui-Badge': {
      backgroundColor: 'var(--er-surface-3)',
      color: 'var(--er-text-muted)',
      ...shorthands.borderColor('transparent'),
      fontWeight: 550,
      fontSize: 'var(--er-text-xs)',
    },
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
    fontSize: 'var(--er-text-sm)',
    backgroundColor: 'var(--er-surface)',
    borderRadius: 'var(--er-radius-sm)',
    padding: '2px 6px',
    wordBreak: 'break-all',
  },
  // A rounded danger box inside the card body.
  warningBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    ...shorthands.margin('0', '16px'),
    ...shorthands.padding('10px', '14px'),
    ...shorthands.border('1px', 'solid', 'var(--er-danger-border)'),
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-danger-soft)',
  },

  // ── Profile list ─────────────────────────────────────────────
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    ...shorthands.margin('0', '16px'),
  },
  // Fixed three-track grid so the avatar, the text block and the action
  // buttons keep the same x-position in every row no matter how long the
  // profile name or URL is.
  profileRow: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    ...shorthands.padding('10px', '12px'),
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-surface)',
    cursor: 'pointer',
    transition: 'background-color 0.1s, border-color 0.1s',
    ':hover': {
      backgroundColor: 'var(--er-hover)',
    },
    // Narrow windows: Connect + edit + delete would squeeze the name and URL
    // down to a couple of characters, so the buttons drop to their own line.
    '@media (max-width: 560px)': {
      gridTemplateColumns: 'auto minmax(0, 1fr)',
      rowGap: tokens.spacingVerticalXS,
    },
  },
  // Selected: the soft indigo band with a hairline ring, as everywhere.
  profileRowActive: {
    ...shorthands.borderColor('var(--er-accent-soft-2)'),
    backgroundColor: 'var(--er-accent-soft)',
    boxShadow: 'inset 0 0 0 1px var(--er-accent-soft-2)',
    ':hover': {
      backgroundColor: 'var(--er-accent-soft)',
    },
  },
  // Initials in a soft tile; the selected environment's tile is filled.
  profileAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-accent-soft)',
    color: 'var(--er-accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--er-text-xs)',
    fontWeight: '600',
    flexShrink: 0,
    textTransform: 'uppercase',
  },
  profileAvatarActive: {
    backgroundColor: 'var(--er-accent-fill)',
    color: 'var(--er-on-accent-fill)',
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
  // Ledger empty state: centred, the icon in a 48px accent tile, a 15px
  // title and a muted hint.
  profileEmptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    textAlign: 'center',
    ...shorthands.margin('0', '16px'),
    ...shorthands.padding('28px', '16px'),
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-surface-2)',
  },
  emptyIcon: {
    boxSizing: 'content-box',
    width: '24px',
    height: '24px',
    fontSize: '24px',
    ...shorthands.padding('12px'),
    marginBottom: '6px',
    borderRadius: 'var(--er-radius-xl)',
    backgroundColor: 'var(--er-accent-soft)',
    color: 'var(--er-accent)',
    flexShrink: 0,
  },
  emptyTitle: {
    fontSize: '15px',
    lineHeight: '22px',
    fontWeight: 600,
    color: 'var(--er-text)',
  },
  emptyHint: {
    fontSize: 'var(--er-text-md)',
    lineHeight: '1.5',
    color: 'var(--er-text-muted)',
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
  connStatusDotConnected: { backgroundColor: 'var(--er-success)' },
  connStatusDotConnecting: { backgroundColor: 'var(--er-warning)' },
  connStatusDotDisconnected: { backgroundColor: 'var(--er-text-subtle)' },
  connStatusDotError: { backgroundColor: 'var(--er-danger)' },
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
    gap: '16px',
    minHeight: '480px',
    width: '100%',
    '@media (max-width: 860px)': {
      gridTemplateColumns: '1fr',
    },
  },
  // Browsing an environment means scrolling long lists, so the boxes grow with
  // the window instead of stopping at a fixed 660px on a tall screen.
  // Each pane is a Ledger panel: white card, rounded, a flat shadow.
  listBox: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    borderRadius: 'var(--er-radius-xl)',
    backgroundColor: 'var(--er-surface)',
    boxShadow: 'var(--er-shadow-1)',
    overflow: 'hidden',
    minHeight: '480px',
    maxHeight: 'max(480px, calc(100vh - 260px))',
  },
  // Panel header: title 14px/600 on the card's white, quiet counts, a hairline below.
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    ...shorthands.padding('8px', '10px', '8px', '16px'),
    backgroundColor: 'var(--er-surface)',
    borderBottom: '1px solid var(--er-border)',
    flexShrink: 0,
    minHeight: '48px',
    boxSizing: 'border-box',
    '& .fui-Body1Strong': {
      fontSize: 'var(--er-text-lg)',
      letterSpacing: '-0.2px',
    },
    '& .fui-Badge': {
      backgroundColor: 'var(--er-surface-3)',
      color: 'var(--er-text-muted)',
      ...shorthands.borderColor('transparent'),
      fontWeight: 550,
      fontSize: 'var(--er-text-xs)',
    },
  },
  listHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  listSearchBar: {
    ...shorthands.padding('10px', '12px'),
    borderBottom: '1px solid var(--er-border)',
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
    ...shorthands.padding('6px', '0'),
  },
  // Rows: rounded, inset from the card's edges, no hairlines between them.
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    ...shorthands.margin('0', '6px'),
    ...shorthands.padding('7px', '10px'),
    borderRadius: '7px',
    ':hover': {
      backgroundColor: 'var(--er-hover)',
    },
    // Badges in a row are borderless pills.
    '& .fui-Badge': {
      ...shorthands.borderColor('transparent'),
      ...shorthands.padding('0', '8px'),
      fontSize: 'var(--er-text-xs)',
      fontWeight: 550,
      letterSpacing: 0,
      textTransform: 'none',
    },
  },
  listItemActive: {
    backgroundColor: 'var(--er-accent-soft)',
    boxShadow: 'inset 0 0 0 1px var(--er-accent-soft-2)',
    ':hover': {
      backgroundColor: 'var(--er-accent-soft)',
    },
  },
  listItemContent: {
    flex: 1,
    minWidth: 0,
  },
  listItemDead: {
    opacity: 0.5,
  },
  listItemChild: {
    backgroundColor: 'transparent',
  },
  listItemChildActive: {
    backgroundColor: 'var(--er-accent-soft)',
    boxShadow: 'inset 0 0 0 1px var(--er-accent-soft-2)',
    ':hover': {
      backgroundColor: 'var(--er-accent-soft)',
    },
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
    borderRadius: 'var(--er-radius-sm)',
    ':hover': {
      backgroundColor: 'var(--er-surface-3)',
      color: 'var(--er-text)',
    },
    transition: 'color 0.1s',
  },
  expandBtnPlaceholder: {
    flexShrink: 0,
    width: '20px',
    height: '20px',
  },

  // ── Pills: kinds in their own tint, states in theirs, neutral grey ──
  typeBadge: {
    flexShrink: 0,
    fontSize: 'var(--er-text-xs)',
    fontWeight: 550,
    letterSpacing: 0,
    textTransform: 'none',
    ...shorthands.borderColor('transparent'),
    backgroundColor: 'var(--er-surface-3)',
    color: 'var(--er-text-muted)',
  },
  typeBadgeModel: { backgroundColor: 'var(--er-model-soft)', color: 'var(--er-model)' },
  typeBadgeMapping: { backgroundColor: 'var(--er-mapping-soft)', color: 'var(--er-mapping)' },
  typeBadgeFormat: { backgroundColor: 'var(--er-format-soft)', color: 'var(--er-format)' },
  pillNeutral: { backgroundColor: 'var(--er-surface-3)', color: 'var(--er-text-muted)' },
  pillSuccess: { backgroundColor: 'var(--er-success-soft)', color: 'var(--er-success)' },
  pillWarning: { backgroundColor: 'var(--er-warning-soft)', color: 'var(--er-warning)' },
  // The version under a configuration's name: a mono pill.
  versionPill: {
    display: 'inline-block',
    marginTop: '3px',
    ...shorthands.padding('0', '7px'),
    borderRadius: 'var(--er-radius-pill)',
    backgroundColor: 'var(--er-surface-3)',
    color: 'var(--er-text-muted)',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: 'var(--er-text-xs)',
    lineHeight: '18px',
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
    gap: '6px',
    ...shorthands.padding('36px', '20px'),
    textAlign: 'center',
    color: 'var(--er-text-muted)',
    '& .fui-Caption1': {
      fontSize: 'var(--er-text-md)',
      lineHeight: '1.5',
    },
  },
  emptyStateRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'stretch',
    width: '100%',
    maxWidth: '340px',
  },

  // ── Footer ────────────────────────────────────────────────────
  // The download bar: a white Ledger card under the two panes.
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    ...shorthands.padding('12px', '14px', '12px', '18px'),
    backgroundColor: 'var(--er-surface)',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    borderRadius: 'var(--er-radius-xl)',
    boxShadow: 'var(--er-shadow-1)',
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

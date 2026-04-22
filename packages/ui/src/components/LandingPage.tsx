import React, { useCallback, useRef, useState } from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  shorthands,
  Button,
  Card,
  CardHeader,
  CardPreview,
  Title1,
  Title3,
  Subtitle2,
  Body1,
  Body1Strong,
  Caption1,
  Caption1Strong,
  Badge,
  Spinner,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  MessageBarActions,
  Tag,
  TagGroup,
  type TagGroupProps,
} from '@fluentui/react-components';
import {
  ArrowUploadRegular,
  ArrowDownloadRegular,
  CheckmarkCircleFilled,
  DataBarVerticalFilled,
  DismissRegular,
  DocumentFilled,
  FolderOpenRegular,
  LinkFilled,
  OpenRegular,
  DeleteRegular,
  SparkleFilled,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';
import { t } from '../i18n';

// ────────────────────────── styles ──────────────────────────

const useStyles = makeStyles({
  root: {
    minHeight: '100%',
    padding: '40px 24px 64px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '32px',
    backgroundColor: `linear-gradient(135deg, ${tokens.colorNeutralBackground1} 0%, ${tokens.colorNeutralBackground2} 100%)`,
  },
  hero: {
    width: '100%',
    maxWidth: '960px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    textAlign: 'center',
  },
  heroLogo: {
    width: '72px',
    height: '72px',
    borderRadius: '20px',
    backgroundColor: `linear-gradient(135deg, ${tokens.colorBrandBackground} 0%, ${tokens.colorBrandBackgroundPressed} 100%)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: tokens.shadow16,
    color: tokens.colorNeutralForegroundOnBrand,
    marginBottom: '8px',
  },
  heroBadge: {
    marginBottom: '4px',
  },
  heroTitle: {
    margin: 0,
  },
  heroSub: {
    color: tokens.colorNeutralForeground2,
    maxWidth: '640px',
  },
  dropzone: {
    width: '100%',
    maxWidth: '720px',
    minHeight: '200px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    borderRadius: tokens.borderRadiusXLarge,
    ...shorthands.border('2px', 'dashed', tokens.colorNeutralStroke1),
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    transitionProperty: 'all',
    transitionDuration: '0.18s',
    transitionTimingFunction: 'ease',
    textAlign: 'center',
    ':hover': {
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      backgroundColor: tokens.colorNeutralBackground1Hover,
      transform: 'translateY(-1px)',
      boxShadow: tokens.shadow8,
    },
    ':focus-visible': {
      ...shorthands.outline('2px', 'solid', tokens.colorStrokeFocus2),
      outlineOffset: '2px',
    },
  },
  dropzoneDragging: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    ...shorthands.borderStyle('solid'),
    backgroundColor: tokens.colorBrandBackground2,
    transform: 'scale(1.01)',
  },
  dropzoneInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  dropzoneIcon: {
    fontSize: '36px',
    color: tokens.colorBrandForeground1,
    display: 'inline-flex',
  },
  tags: {
    marginTop: '4px',
  },
  loadedBar: {
    width: '100%',
    maxWidth: '720px',
  },
  cardGrid: {
    width: '100%',
    maxWidth: '1160px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '20px',
  },
  card: {
    padding: '20px',
    gap: '12px',
    backgroundColor: tokens.colorNeutralBackground1,
    transitionProperty: 'transform, box-shadow',
    transitionDuration: '0.18s',
    transitionTimingFunction: 'ease',
    ':hover': {
      transform: 'translateY(-2px)',
      boxShadow: tokens.shadow16,
    },
  },
  cardIconInfo: {
    backgroundColor: tokens.colorPaletteBlueBackground2,
    color: tokens.colorPaletteBlueForeground2,
  },
  cardIconSuccess: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground2,
  },
  cardIconPurple: {
    backgroundColor: tokens.colorPalettePurpleBackground2,
    color: tokens.colorPalettePurpleForeground2,
  },
  cardIcon: {
    width: '48px',
    height: '48px',
    borderRadius: tokens.borderRadiusLarge,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
  },
  cardFeatures: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  cardFeature: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  cardFeatureIcon: {
    color: tokens.colorPaletteGreenForeground1,
    flexShrink: 0,
    marginTop: '2px',
  },
  cardHint: {
    marginTop: '8px',
    padding: '8px 10px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
  },
  section: {
    width: '100%',
    maxWidth: '1160px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  recentList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '8px',
  },
  recentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
  },
  recentName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  steps: {
    width: '100%',
    maxWidth: '1160px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '16px',
  },
  step: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
  },
  stepNum: {
    width: '32px',
    height: '32px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: tokens.fontWeightSemibold,
    flexShrink: 0,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: '24px',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    textAlign: 'center',
  },
});

interface LandingPageProps {
  onFilesLoaded: () => void;
}

type LandingAccent = 'info' | 'success' | 'purple';

// ────────────────────────── component ──────────────────────────

export function LandingPage({ onFilesLoaded }: LandingPageProps) {
  const styles = useStyles();
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const configs = useAppStore(s => s.configurations);
  const recentFiles = useAppStore(s => s.recentFiles);
  const removeRecentFile = useAppStore(s => s.removeRecentFile);
  const clearRecentFiles = useAppStore(s => s.clearRecentFiles);
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: FileList | null) => {
    setLoading(true);
    const { loaded, errors: newErrors } = await loadBrowserFiles(files, loadXmlFile);
    setLoading(false);
    if (newErrors.length > 0) setErrors(prev => [...prev, ...newErrors]);
    if (loaded > 0) onFilesLoaded();
  }, [loadXmlFile, onFilesLoaded]);

  const handleOpenFiles = useCallback(async () => {
    setLoading(true);
    const result = await openFilesWithSystemDialog(loadXmlFile);
    if (result == null) {
      setLoading(false);
      fileInputRef.current?.click();
      return;
    }
    setLoading(false);
    if (result.errors.length > 0) setErrors(prev => [...prev, ...result.errors]);
    if (result.loaded > 0) onFilesLoaded();
  }, [loadXmlFile, onFilesLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleRecentDismiss: TagGroupProps['onDismiss'] = (_, data) => {
    removeRecentFile(String(data.value));
  };

  return (
    <div
      className={styles.root}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroLogo} aria-hidden="true">
          <SparkleFilled fontSize={36} />
        </div>
        <Badge
          className={styles.heroBadge}
          appearance="tint"
          color="brand"
          size="medium"
        >
          {t.landingBadge}
        </Badge>
        <Title1 as="h1" className={styles.heroTitle}>{t.landingTitle}</Title1>
        <Body1 className={styles.heroSub}>{t.landingSub}</Body1>
      </div>

      {/* Drop Zone */}
      <div
        className={mergeClasses(styles.dropzone, isDragging && styles.dropzoneDragging)}
        onClick={handleOpenFiles}
        onKeyDown={e => e.key === 'Enter' && handleOpenFiles()}
        role="button"
        tabIndex={0}
        aria-label={t.landingDropAriaLabel}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xml"
          style={{ display: 'none' }}
          onChange={e => { processFiles(e.target.files); e.target.value = ''; }}
        />
        {loading ? (
          <div className={styles.dropzoneInner}>
            <Spinner size="large" label={t.landingLoading} labelPosition="below" />
          </div>
        ) : (
          <div className={styles.dropzoneInner}>
            <span className={styles.dropzoneIcon} aria-hidden="true">
              {isDragging ? <ArrowDownloadRegular fontSize={40} /> : <FolderOpenRegular fontSize={40} />}
            </span>
            <Title3 as="h3">{isDragging ? t.landingDropRelease : t.landingDropPrimary}</Title3>
            <Body1 style={{ color: tokens.colorNeutralForeground2 }}>{t.landingDropSecondary}</Body1>
            <div className={styles.tags}>
              <TagGroup aria-label="File types" size="small">
                <Tag shape="circular" appearance="brand" media={<DataBarVerticalFilled />}>{t.landingPillModel}</Tag>
                <Tag shape="circular" appearance="brand" media={<LinkFilled />}>{t.landingPillMapping}</Tag>
                <Tag shape="circular" appearance="brand" media={<DocumentFilled />}>{t.landingPillFormat}</Tag>
              </TagGroup>
            </div>
          </div>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {errors.map((e, i) => (
            <MessageBar key={i} intent="error" layout="multiline">
              <MessageBarBody>
                <MessageBarTitle>{t.landingErrors}</MessageBarTitle>
                {e}
              </MessageBarBody>
              <MessageBarActions
                containerAction={
                  <Button
                    appearance="transparent"
                    aria-label={t.landingDismiss}
                    icon={<DismissRegular />}
                    size="small"
                    onClick={() => setErrors(prev => prev.filter((_, idx) => idx !== i))}
                  />
                }
              />
            </MessageBar>
          ))}
        </div>
      )}

      {/* Already loaded */}
      {configs.length > 0 && (
        <MessageBar className={styles.loadedBar} intent="info">
          <MessageBarBody>{t.landingLoaded(configs.length)}</MessageBarBody>
          <MessageBarActions>
            <Button appearance="primary" size="small" icon={<OpenRegular />} onClick={onFilesLoaded}>
              {t.landingOpen}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      {/* Component Cards */}
      <div className={styles.cardGrid}>
        <ComponentCard
          accent="info"
          icon={<DataBarVerticalFilled fontSize={24} />}
          title={t.landingCardModelTitle}
          subtitle={t.landingCardModelSubtitle}
          description={t.landingCardModelDesc}
          features={t.landingCardModelFeatures}
          fileHint={t.landingCardModelHint}
        />
        <ComponentCard
          accent="success"
          icon={<LinkFilled fontSize={24} />}
          title={t.landingCardMappingTitle}
          subtitle={t.landingCardMappingSubtitle}
          description={t.landingCardMappingDesc}
          features={t.landingCardMappingFeatures}
          fileHint={t.landingCardMappingHint}
        />
        <ComponentCard
          accent="purple"
          icon={<DocumentFilled fontSize={24} />}
          title={t.landingCardFormatTitle}
          subtitle={t.landingCardFormatSubtitle}
          description={t.landingCardFormatDesc}
          features={t.landingCardFormatFeatures}
          fileHint={t.landingCardFormatHint}
        />
      </div>

      {/* Recent files */}
      {recentFiles.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Subtitle2>{t.recentFiles}</Subtitle2>
            <Button
              appearance="subtle"
              size="small"
              icon={<DeleteRegular />}
              onClick={clearRecentFiles}
            >
              {t.clearRecent}
            </Button>
          </div>
          <div className={styles.recentList}>
            {recentFiles.map(rf => (
              <div key={rf.path} className={styles.recentItem} title={rf.path}>
                <span aria-hidden="true" style={{ display: 'inline-flex', color: tokens.colorBrandForeground1 }}>
                  {rf.kind === 'DataModel' ? <DataBarVerticalFilled fontSize={18} />
                    : rf.kind === 'ModelMapping' ? <LinkFilled fontSize={18} />
                    : rf.kind === 'Format' ? <DocumentFilled fontSize={18} />
                    : <DocumentFilled fontSize={18} />}
                </span>
                <div className={styles.recentName}>
                  <Body1Strong>{rf.name}</Body1Strong>
                  <div style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rf.path}
                  </div>
                </div>
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t.dismiss}
                  onClick={e => { e.stopPropagation(); removeRecentFile(rf.path); }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className={styles.section}>
        <Subtitle2>{t.landingHowTitle}</Subtitle2>
        <div className={styles.steps}>
          <HowStep n={1} title={t.landingStep1Title} desc={t.landingStep1Desc} />
          <HowStep n={2} title={t.landingStep2Title} desc={t.landingStep2Desc} />
          <HowStep n={3} title={t.landingStep3Title} desc={t.landingStep3Desc} />
          <HowStep n={4} title={t.landingStep4Title} desc={t.landingStep4Desc} />
        </div>
      </div>

      {/* Footer */}
      <Divider style={{ width: '100%', maxWidth: 1160 }} />
      <Caption1 className={styles.footer}>{t.landingFooter}</Caption1>
    </div>
  );
}

// ────────────────────────── cards ──────────────────────────

function ComponentCard({
  accent, icon, title, subtitle, description, features, fileHint,
}: {
  accent: LandingAccent;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  fileHint: string;
}) {
  const styles = useStyles();
  const accentClass = accent === 'info' ? styles.cardIconInfo
    : accent === 'success' ? styles.cardIconSuccess
    : styles.cardIconPurple;

  return (
    <Card className={styles.card} appearance="filled-alternative">
      <CardHeader
        image={<div className={mergeClasses(styles.cardIcon, accentClass)} aria-hidden="true">{icon}</div>}
        header={<Body1Strong>{title}</Body1Strong>}
        description={<Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{subtitle}</Caption1>}
      />
      <Body1>{description}</Body1>
      <ul className={styles.cardFeatures}>
        {features.map((f, i) => (
          <li key={i} className={styles.cardFeature}>
            <CheckmarkCircleFilled fontSize={16} className={styles.cardFeatureIcon} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className={styles.cardHint} title="Příklad souboru">📎 {fileHint}</div>
    </Card>
  );
}

// ────────────────────────── steps ──────────────────────────

function decodeSafeEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function HowStep({ n, title, desc }: { n: number; title: string; desc: string }) {
  const styles = useStyles();
  return (
    <div className={styles.step}>
      <div className={styles.stepNum} aria-hidden="true">{n}</div>
      <div>
        <Body1Strong>{title}</Body1Strong>
        <div style={{ color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 }}>
          {decodeSafeEntities(desc)}
        </div>
      </div>
    </div>
  );
}

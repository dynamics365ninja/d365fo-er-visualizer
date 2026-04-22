import React, { useCallback, useRef, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { DismissRegular, OpenRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';
import { t } from '../i18n';

type LandingAccentTone = 'info' | 'success' | 'purple';

interface LandingPageProps {
  /** Called when user drops/selects files so App can switch to designer view */
  onFilesLoaded: () => void;
}

export function LandingPage({ onFilesLoaded }: LandingPageProps) {
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

  return (
    <div
      className="landing-root"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* ── Hero ── */}
      <div className="landing-hero">
        <div className="landing-hero-logo">
          <span className="landing-hero-logo-icon">⚡</span>
        </div>
        <div className="landing-hero-badge">{t.landingBadge}</div>
        <h1 className="landing-hero-title">{t.landingTitle}</h1>
        <p className="landing-hero-sub">{t.landingSub}</p>
      </div>

      {/* ── Drop Zone ── */}
      <div
        className={`landing-dropzone${isDragging ? ' dragging' : ''}`}
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
          <div className="landing-dropzone-inner">
            <div className="landing-spinner">⏳</div>
            <div className="landing-dropzone-primary">{t.landingLoading}</div>
          </div>
        ) : (
          <div className="landing-dropzone-inner">
            <div className="landing-dropzone-icon">{isDragging ? '📥' : '📂'}</div>
            <div className="landing-dropzone-primary">
              {isDragging ? t.landingDropRelease : t.landingDropPrimary}
            </div>
            <div className="landing-dropzone-secondary">{t.landingDropSecondary}</div>
            <div className="landing-dropzone-types">
              <span className="landing-type-pill landing-accent-info">{t.landingPillModel}</span>
              <span className="landing-type-pill landing-accent-success">{t.landingPillMapping}</span>
              <span className="landing-type-pill landing-accent-purple">{t.landingPillFormat}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Errors ── */}
      {errors.length > 0 && (
        <div className="landing-errors">
          <div className="landing-errors-title">{t.landingErrors}</div>
          {errors.map((e, i) => (
            <div key={i} className="landing-error-item">{e}</div>
          ))}
          <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={() => setErrors([])}>{t.landingDismiss}</Button>
        </div>
      )}

      {/* ── Already loaded ── */}
      {configs.length > 0 && (
        <div className="landing-loaded-bar">
          <span>{t.landingLoaded(configs.length)}</span>
          <Button appearance="primary" size="small" icon={<OpenRegular />} onClick={onFilesLoaded}>
            {t.landingOpen}
          </Button>
        </div>
      )}

      {/* ── Component Cards ── */}
      <div className="landing-cards">
        <ComponentCard
          accentTone="info"
          icon="📐"
          title={t.landingCardModelTitle}
          subtitle={t.landingCardModelSubtitle}
          description={t.landingCardModelDesc}
          features={t.landingCardModelFeatures}
          fileHint={t.landingCardModelHint}
        />
        <ComponentCard
          accentTone="success"
          icon="🔗"
          title={t.landingCardMappingTitle}
          subtitle={t.landingCardMappingSubtitle}
          description={t.landingCardMappingDesc}
          features={t.landingCardMappingFeatures}
          fileHint={t.landingCardMappingHint}
        />
        <ComponentCard
          accentTone="purple"
          icon="📄"
          title={t.landingCardFormatTitle}
          subtitle={t.landingCardFormatSubtitle}
          description={t.landingCardFormatDesc}
          features={t.landingCardFormatFeatures}
          fileHint={t.landingCardFormatHint}
        />
      </div>

      {/* ── Recent files ── */}
      {recentFiles.length > 0 && (
        <div className="landing-recent">
          <div className="landing-section-title-row">
            <div className="landing-section-title">{t.recentFiles}</div>
            <Button appearance="subtle" size="small" onClick={clearRecentFiles}>
              {t.clearRecent}
            </Button>
          </div>
          <ul className="landing-recent-list">
            {recentFiles.map(rf => (
              <li key={rf.path} className="landing-recent-item">
                <span className="landing-recent-icon" aria-hidden="true">
                  {rf.kind === 'DataModel' ? '📐' : rf.kind === 'ModelMapping' ? '🔗' : rf.kind === 'Format' ? '📄' : '📎'}
                </span>
                <span className="landing-recent-name" title={rf.path}>{rf.name}</span>
                <span className="landing-recent-path" title={rf.path}>{rf.path}</span>
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t.dismiss}
                  onClick={e => { e.stopPropagation(); removeRecentFile(rf.path); }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── How it works ── */}
      <div className="landing-how">
        <div className="landing-section-title">{t.landingHowTitle}</div>
        <div className="landing-steps">
          <HowStep n={1} title={t.landingStep1Title} desc={t.landingStep1Desc} />
          <HowStep n={2} title={t.landingStep2Title} desc={t.landingStep2Desc} />
          <HowStep n={3} title={t.landingStep3Title} desc={t.landingStep3Desc} />
          <HowStep n={4} title={t.landingStep4Title} desc={t.landingStep4Desc} />
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="landing-footer">
        {t.landingFooter}
      </div>
    </div>
  );
}

// ─── Component card ───

function ComponentCard({
  accentTone,
  icon,
  title,
  subtitle,
  description,
  features,
  fileHint,
}: {
  accentTone: LandingAccentTone;
  icon: string;
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  fileHint: string;
}) {
  return (
    <div className={`landing-card landing-accent-${accentTone}`}>
      <div className="landing-card-icon">{icon}</div>
      <div className="landing-card-title">{title}</div>
      <div className="landing-card-subtitle">{subtitle}</div>
      <p className="landing-card-desc">{description}</p>
      <ul className="landing-card-features">
        {features.map((f, i) => (
          <li key={i}><span className="landing-card-check">✓</span> {f}</li>
        ))}
      </ul>
      <div className="landing-card-hint" title="Příklad souboru">📎 {fileHint}</div>
    </div>
  );
}

// ─── How step ───

/**
 * Decode a minimal set of HTML entities that previously lived in the i18n
 * strings (&quot;). We no longer render translated content as raw HTML — the
 * entire string is now rendered as text, so any residual entity stays visible
 * only for older cached translations.
 */
function decodeSafeEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function HowStep({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="landing-step">
      <div className="landing-step-num">{n}</div>
      <div className="landing-step-body">
        <div className="landing-step-title">{title}</div>
        <div className="landing-step-desc">{decodeSafeEntities(desc)}</div>
      </div>
    </div>
  );
}

import { useMemo, useRef } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { BranchCompareRegular, CloudRegular, DocumentRegular, FolderOpenRegular } from '@fluentui/react-icons';
import { compareConfigVersions, useAppStore, type RecentFile } from '../state/store';
import { normalizeSolutionId } from '../state/configuration-merge';
import { t, useLocale } from '../i18n';
import { getBestVersion } from '../utils/model-hierarchy';
import { formatRelativeTime } from '../utils/recent-display';
import { pickXmlFileWithSystemDialog } from '../utils/file-loading';

/** Cached versions of the configuration other than the loaded one, newest first. */
export function otherCachedVersions(
  recentFiles: readonly RecentFile[],
  cachedPaths: ReadonlySet<string>,
  subject: { filePath: string; kind: string; solutionId?: string; solutionName?: string },
): RecentFile[] {
  const solutionId = normalizeSolutionId(subject.solutionId);
  return recentFiles
    .filter(file => file.path !== subject.filePath && file.kind === subject.kind)
    .filter(file => (solutionId
      ? normalizeSolutionId(file.solutionId) === solutionId
      : Boolean(subject.solutionName) && file.solutionName === subject.solutionName))
    .filter(file => cachedPaths.has(file.path) || (file.bundlePath ? cachedPaths.has(file.bundlePath) : false))
    .sort((a, b) => compareConfigVersions(b.version, a.version) || b.openedAt - a.openedAt);
}

/**
 * "Compare with another version": a version from the cache of recent
 * configurations, or an XML export picked from disk.
 */
export function VersionComparePicker() {
  const locale = useLocale();
  const configIndex = useAppStore(s => s.versionComparePickerIndex);
  const configurations = useAppStore(s => s.configurations);
  const recentFiles = useAppStore(s => s.recentFiles);
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const close = useAppStore(s => s.openVersionComparePicker);
  const compareWithCachedVersion = useAppStore(s => s.compareWithCachedVersion);
  const compareWithXml = useAppStore(s => s.compareWithXml);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const config = configIndex != null ? configurations[configIndex] : undefined;
  const candidates = useMemo(() => (config
    ? otherCachedVersions(recentFiles, cachedPaths, {
      filePath: config.filePath,
      kind: config.content.kind,
      solutionId: config.solutionVersion.solution.id,
      solutionName: config.solutionVersion.solution.name,
    })
    : []), [config, recentFiles, cachedPaths]);

  if (configIndex == null || !config) return null;
  const name = config.solutionVersion.solution.name || config.filePath;

  const pickCached = (path: string) => {
    close(null);
    void compareWithCachedVersion(configIndex, path);
  };

  const pickFile = async () => {
    const picked = await pickXmlFileWithSystemDialog();
    if (picked === undefined) {
      fileInputRef.current?.click();
      return;
    }
    if (picked === null) return;
    close(null);
    compareWithXml(configIndex, picked.content, picked.name);
  };

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) close(null); }}>
      <DialogSurface className="vcmp-picker">
        <DialogBody>
          <DialogTitle>
            <span className="vcmp-picker__title">
              <BranchCompareRegular fontSize={18} aria-hidden />
              {t.comparePickerTitle(name)}
            </span>
          </DialogTitle>
          <DialogContent>
            <p className="vcmp-picker__intro">{t.comparePickerIntro}</p>
            <p className="vcmp-picker__loaded">{t.comparePickerLoaded(`v${getBestVersion(config) ?? '?'}`)}</p>
            <h3 className="vcmp-picker__heading">{t.comparePickerCached}</h3>
            {candidates.length === 0 ? (
              <p className="vcmp-picker__none">{t.comparePickerNone}</p>
            ) : (
              <ul className="vcmp-picker__list">
                {candidates.map(file => (
                  <li key={file.path}>
                    <button type="button" className="vcmp-picker__row" onClick={() => pickCached(file.path)} title={file.path}>
                      <span className="vcmp-picker__version">v{file.version ?? '?'}</span>
                      <span className="vcmp-picker__source" aria-hidden>
                        {file.source === 'fno' ? <CloudRegular fontSize={14} /> : <DocumentRegular fontSize={14} />}
                      </span>
                      <span className="vcmp-picker__name">{file.name}</span>
                      <span className="vcmp-picker__when">{t.comparePickerOpenedAt(formatRelativeTime(file.openedAt, locale))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="vcmp-picker__note">{t.comparePickerFnoNote}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              hidden
              onChange={async e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const content = await file.text();
                close(null);
                compareWithXml(configIndex, content, file.name);
              }}
            />
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => close(null)}>{t.depPromptCancel}</Button>
            {/* Fluent's own styles win over a class rule; keep the label on one line inline. */}
            <Button appearance="primary" icon={<FolderOpenRegular />} style={{ whiteSpace: 'nowrap', minWidth: 'max-content' }} onClick={() => { void pickFile(); }}>
              {t.comparePickerFromFile}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

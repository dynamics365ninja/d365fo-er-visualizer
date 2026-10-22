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
import { ArrowDownloadRegular, BranchCompareRegular, BranchForkRegular, CloudRegular, DocumentRegular, FolderOpenRegular } from '@fluentui/react-icons';
import { compareConfigVersions, useAppStore, type RecentFile } from '../state/store';
import { normalizeSolutionId } from '../state/configuration-merge';
import { baseReference, cachedBaseVersions, isDerivedFromVersion, loadedBase } from '../state/base-configuration';
import { useFnoSession } from '../state/fno-session';
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
 * configurations, or an XML export picked from disk. In `base` mode the same
 * for the base a derived configuration was made from — loaded in the
 * workspace, cached, downloaded from F&O or picked from disk.
 */
export function VersionComparePicker() {
  const locale = useLocale();
  const configIndex = useAppStore(s => s.versionComparePickerIndex);
  const pickerMode = useAppStore(s => s.versionComparePickerMode);
  const configurations = useAppStore(s => s.configurations);
  const recentFiles = useAppStore(s => s.recentFiles);
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const open = useAppStore(s => s.openVersionComparePicker);
  const openVersionCompare = useAppStore(s => s.openVersionCompare);
  const compareWithCachedVersion = useAppStore(s => s.compareWithCachedVersion);
  const compareWithBaseFromFno = useAppStore(s => s.compareWithBaseFromFno);
  const compareWithXml = useAppStore(s => s.compareWithXml);
  const fnoConnected = useFnoSession(s => s.connState.kind === 'connected' && Boolean(s.activeProfileId));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const close = (index: null) => open(index);

  const config = configIndex != null ? configurations[configIndex] : undefined;
  const base = baseReference(config);
  const mode = pickerMode === 'base' && base ? 'base' : 'version';
  const candidates = useMemo(() => {
    if (!config) return [];
    if (mode === 'base') return cachedBaseVersions(recentFiles, cachedPaths, config);
    return otherCachedVersions(recentFiles, cachedPaths, {
      filePath: config.filePath,
      kind: config.content.kind,
      solutionId: config.solutionVersion.solution.id,
      solutionName: config.solutionVersion.solution.name,
    });
  }, [config, mode, recentFiles, cachedPaths]);
  const loaded = useMemo(() => {
    const found = config && mode === 'base' ? loadedBase(configurations, config) : undefined;
    return found && found.config.content.kind === config?.content.kind ? found : undefined;
  }, [config, mode, configurations]);

  if (configIndex == null || !config) return null;
  const name = config.solutionVersion.solution.name || config.filePath;
  const baseName = base?.name || base?.id || '';
  const baseVersion = base?.version != null ? String(base.version) : '?';

  const pickCached = (path: string) => {
    close(null);
    void compareWithCachedVersion(configIndex, path, mode);
  };

  const pickFile = async () => {
    const picked = await pickXmlFileWithSystemDialog();
    if (picked === undefined) {
      fileInputRef.current?.click();
      return;
    }
    if (picked === null) return;
    close(null);
    compareWithXml(configIndex, picked.content, picked.name, { mode });
  };

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) close(null); }}>
      <DialogSurface className="vcmp-picker">
        <DialogBody>
          <DialogTitle>
            <span className="vcmp-picker__title">
              {mode === 'base' ? <BranchForkRegular fontSize={18} aria-hidden /> : <BranchCompareRegular fontSize={18} aria-hidden />}
              {mode === 'base' ? t.comparePickerBaseTitle(name) : t.comparePickerTitle(name)}
            </span>
          </DialogTitle>
          <DialogContent>
            {mode === 'base' ? (
              <>
                <p className="vcmp-picker__intro">{t.comparePickerBaseIntro(baseName, baseVersion)}</p>
                {loaded && (
                  <>
                    <h3 className="vcmp-picker__heading">{t.comparePickerBaseLoaded}</h3>
                    <ul className="vcmp-picker__list">
                      <li>
                        <button
                          type="button"
                          className="vcmp-picker__row"
                          onClick={() => { close(null); openVersionCompare(configIndex, loaded.config, { mode: 'base' }); }}
                        >
                          <span className="vcmp-picker__version">v{getBestVersion(loaded.config) ?? '?'}</span>
                          <span className="vcmp-picker__source" aria-hidden><DocumentRegular fontSize={14} /></span>
                          <span className="vcmp-picker__name">{loaded.config.solutionVersion.solution.name}</span>
                        </button>
                      </li>
                    </ul>
                  </>
                )}
                <h3 className="vcmp-picker__heading">{t.comparePickerBaseCached}</h3>
              </>
            ) : (
              <>
                <p className="vcmp-picker__intro">{t.comparePickerIntro}</p>
                <p className="vcmp-picker__loaded">{t.comparePickerLoaded(`v${getBestVersion(config) ?? '?'}`)}</p>
                <h3 className="vcmp-picker__heading">{t.comparePickerCached}</h3>
              </>
            )}
            {candidates.length === 0 ? (
              <p className="vcmp-picker__none">{mode === 'base' ? t.comparePickerBaseNone : t.comparePickerNone}</p>
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
                      {mode === 'base' && isDerivedFromVersion(file.version, base) && (
                        <span className="vcmp-picker__tag">{t.comparePickerBaseExact}</span>
                      )}
                      <span className="vcmp-picker__when">{t.comparePickerOpenedAt(formatRelativeTime(file.openedAt, locale))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {mode === 'base' && (
              <div className="vcmp-picker__fno">
                <Button
                  appearance="secondary"
                  icon={<ArrowDownloadRegular />}
                  disabled={!fnoConnected}
                  onClick={() => { close(null); void compareWithBaseFromFno(configIndex); }}
                >
                  {t.comparePickerBaseFno}
                </Button>
                <p className="vcmp-picker__note">{fnoConnected ? t.comparePickerBaseFnoHint : t.comparePickerBaseFnoOffline}</p>
              </div>
            )}
            {base && (
              <button
                type="button"
                className="vcmp-picker__switch"
                onClick={() => open(configIndex, mode === 'base' ? 'version' : 'base')}
              >
                {mode === 'base'
                  ? <><BranchCompareRegular fontSize={14} aria-hidden /> {t.comparePickerSwitchToVersion}</>
                  : <><BranchForkRegular fontSize={14} aria-hidden /> {t.comparePickerSwitchToBase(baseName)}</>}
              </button>
            )}
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
                compareWithXml(configIndex, content, file.name, { mode });
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

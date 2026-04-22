/**
 * F&O connector panel — shown on the Landing page under the "D365 F&O server"
 * tab. Lets the user:
 *   1) manage connection profiles (add/pick/remove)
 *   2) sign in with MSAL (popup or loopback)
 *   3) browse ER solutions and their configurations
 *   4) multi-select configurations and ingest them into the session
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Field,
  Input,
  Dropdown,
  Option,
  Checkbox,
  Spinner,
  Caption1,
  Title3,
  Body1,
  Body1Strong,
  Divider,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import {
  DeleteRegular,
  PlugConnectedRegular,
  PlugDisconnectedRegular,
  CloudArrowDownRegular,
  ArrowSyncRegular,
} from '@fluentui/react-icons';
import type {
  ErComponentType,
  ErConfigSummary,
  ErSolutionSummary,
  FnoConnection,
} from '@er-visualizer/fno-client';
import { t } from '../i18n';
import { useAppStore } from '../state/store';
import { useFnoProfiles, newProfileId } from '../state/fno-profiles';
import { fnoSession } from '../fno/session';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    ...shorthands.padding(tokens.spacingVerticalL),
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  row: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  profileRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
  },
  profileRowActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '320px 1fr',
    gap: tokens.spacingHorizontalM,
    minHeight: '320px',
  },
  listBox: {
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    overflowY: 'auto',
    maxHeight: '480px',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
    cursor: 'pointer',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  listItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: 'sticky',
    top: 0,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    justifyContent: 'flex-end',
  },
});

type ConnectionState =
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected'; account: string }
  | { kind: 'error'; message: string };

const DEFAULT_CLIENT_ID = 'a5191df1-dea6-4df3-a36e-ce3fa1406c9d';

export const FnoConnectPanel: React.FC = () => {
  const styles = useStyles();
  const pushToast = useAppStore(s => s.pushToast);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const { profiles, upsert, remove, markUsed } = useFnoProfiles();

  // Editor state
  const [profileName, setProfileName] = useState('');
  const [envUrl, setEnvUrl] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);

  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [connState, setConnState] = useState<ConnectionState>({ kind: 'disconnected' });

  const [solutions, setSolutions] = useState<ErSolutionSummary[]>([]);
  const [loadingSolutions, setLoadingSolutions] = useState(false);
  const [activeSolution, setActiveSolution] = useState<string | null>(null);

  const [components, setComponents] = useState<ErConfigSummary[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [componentTypeFilter, setComponentTypeFilter] = useState<ErComponentType | 'All'>('All');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [ingesting, setIngesting] = useState(false);

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  // When the active profile changes, reset dependent state.
  useEffect(() => {
    setConnState({ kind: 'disconnected' });
    setSolutions([]);
    setActiveSolution(null);
    setComponents([]);
    setSelected(new Set());
  }, [activeProfileId]);

  const canSave = profileName.trim().length > 0 && envUrl.trim().length > 0 && tenantId.trim().length > 0 && clientId.trim().length > 0;

  const handleSaveProfile = useCallback(() => {
    const profile: FnoConnection = {
      id: newProfileId(),
      displayName: profileName.trim(),
      envUrl: envUrl.trim().replace(/\/+$/, ''),
      tenantId: tenantId.trim(),
      clientId: clientId.trim(),
      createdAt: Date.now(),
    };
    upsert(profile);
    setActiveProfileId(profile.id);
    setProfileName('');
    setEnvUrl('');
    setTenantId('');
  }, [profileName, envUrl, tenantId, clientId, upsert]);

  const handleConnect = useCallback(async () => {
    if (!activeProfile) return;
    setConnState({ kind: 'connecting' });
    try {
      const auth = await fnoSession.signIn(activeProfile);
      markUsed(activeProfile.id);
      setConnState({ kind: 'connected', account: auth.account?.username ?? 'unknown' });
      setLoadingSolutions(true);
      try {
        const list = await fnoSession.listSolutions(activeProfile);
        setSolutions(list);
      } finally {
        setLoadingSolutions(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnState({ kind: 'error', message });
      pushToast({ kind: 'error', message: t.fnoSignInFailed(message) });
    }
  }, [activeProfile, markUsed, pushToast]);

  const handleDisconnect = useCallback(async () => {
    if (!activeProfile) return;
    await fnoSession.signOut(activeProfile);
    setConnState({ kind: 'disconnected' });
    setSolutions([]);
    setComponents([]);
    setActiveSolution(null);
    setSelected(new Set());
  }, [activeProfile]);

  const handlePickSolution = useCallback(async (solutionName: string) => {
    if (!activeProfile) return;
    setActiveSolution(solutionName);
    setSelected(new Set());
    setLoadingComponents(true);
    setComponents([]);
    try {
      const list = await fnoSession.listComponents(activeProfile, solutionName);
      setComponents(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      setLoadingComponents(false);
    }
  }, [activeProfile, pushToast]);

  const filteredComponents = useMemo(() => {
    if (componentTypeFilter === 'All') return components;
    return components.filter(c => c.componentType === componentTypeFilter);
  }, [components, componentTypeFilter]);

  const toggleSelect = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(filteredComponents.map(componentKey)));
  }, [filteredComponents]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleLoadSelected = useCallback(async () => {
    if (!activeProfile) return;
    const toLoad = filteredComponents.filter(c => selected.has(componentKey(c)));
    if (toLoad.length === 0) return;
    setIngesting(true);
    let ok = 0;
    for (const component of toLoad) {
      try {
        const { xml, syntheticPath } = await fnoSession.downloadConfiguration(activeProfile, component);
        loadXmlFile(xml, syntheticPath);
        ok += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushToast({ kind: 'error', message: t.fnoDownloadFailed(component.configurationName, message) });
      }
    }
    setIngesting(false);
    if (ok > 0) {
      pushToast({ kind: 'success', message: t.fnoLoadedCount(ok) });
    }
  }, [activeProfile, filteredComponents, selected, loadXmlFile, pushToast]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Title3>{t.fnoHeading}</Title3>
        <Caption1>{t.fnoSubheading}</Caption1>
      </div>

      <div className={styles.fieldGrid}>
        <Field label={t.fnoProfileName}>
          <Input value={profileName} onChange={(_, d) => setProfileName(d.value)} placeholder="CHE · Sandbox" />
        </Field>
        <Field label={t.fnoEnvUrl}>
          <Input value={envUrl} onChange={(_, d) => setEnvUrl(d.value)} placeholder="https://org.sandbox.operations.dynamics.com" />
        </Field>
        <Field label={t.fnoTenantId}>
          <Input value={tenantId} onChange={(_, d) => setTenantId(d.value)} placeholder="contoso.onmicrosoft.com nebo GUID" />
        </Field>
        <Field label={t.fnoClientId}>
          <Input value={clientId} onChange={(_, d) => setClientId(d.value)} />
        </Field>
      </div>
      <div>
        <Button appearance="primary" disabled={!canSave} onClick={handleSaveProfile}>
          {t.fnoSaveProfile}
        </Button>
      </div>

      <Divider />

      <Body1Strong>{t.fnoProfiles}</Body1Strong>
      {profiles.length === 0 ? (
        <Body1>{t.fnoNoProfiles}</Body1>
      ) : (
        <div className={styles.profileList}>
          {profiles.map(p => (
            <div
              key={p.id}
              className={`${styles.profileRow} ${activeProfileId === p.id ? styles.profileRowActive : ''}`}
              onClick={() => setActiveProfileId(p.id)}
              role="button"
              tabIndex={0}
            >
              <div>
                <Body1Strong>{p.displayName}</Body1Strong>
                <div><Caption1>{p.envUrl}</Caption1></div>
              </div>
              <Button
                appearance="subtle"
                icon={<DeleteRegular />}
                aria-label={t.fnoRemoveProfile}
                onClick={(e) => { e.stopPropagation(); remove(p.id); if (activeProfileId === p.id) setActiveProfileId(null); }}
              />
            </div>
          ))}
        </div>
      )}

      {activeProfile && (
        <>
          <Divider />
          <div className={styles.row}>
            {connState.kind === 'connected' ? (
              <>
                <Body1>{t.fnoConnected(connState.account)}</Body1>
                <Button icon={<PlugDisconnectedRegular />} onClick={handleDisconnect}>{t.fnoDisconnect}</Button>
              </>
            ) : (
              <Button
                appearance="primary"
                icon={<PlugConnectedRegular />}
                onClick={handleConnect}
                disabled={connState.kind === 'connecting'}
              >
                {connState.kind === 'connecting' ? t.fnoConnecting : t.fnoConnect}
              </Button>
            )}
          </div>

          {connState.kind === 'error' && (
            <MessageBar intent="error">
              <MessageBarBody>{connState.message}</MessageBarBody>
            </MessageBar>
          )}
        </>
      )}

      {connState.kind === 'connected' && (
        <div className={styles.columns}>
          <div className={styles.listBox}>
            <div className={styles.listHeader}>
              <Body1Strong>{t.fnoSolutions}</Body1Strong>
              {loadingSolutions && <Spinner size="tiny" />}
            </div>
            {solutions.map(sol => (
              <div
                key={sol.solutionName}
                className={`${styles.listItem} ${activeSolution === sol.solutionName ? styles.listItemActive : ''}`}
                onClick={() => handlePickSolution(sol.solutionName)}
                role="button"
                tabIndex={0}
              >
                <div>
                  <Body1Strong>{sol.displayName ?? sol.solutionName}</Body1Strong>
                  <div><Caption1>{sol.publisher ?? ''} {sol.version ? `· v${sol.version}` : ''}</Caption1></div>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.listBox}>
            <div className={styles.listHeader}>
              <Body1Strong>{t.fnoConfigurations}</Body1Strong>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {loadingComponents && <Spinner size="tiny" />}
                <Dropdown
                  size="small"
                  value={componentTypeFilter === 'All' ? t.fnoAllTypes : componentTypeFilter}
                  selectedOptions={[componentTypeFilter]}
                  onOptionSelect={(_, d) => setComponentTypeFilter(d.optionValue as ErComponentType | 'All')}
                >
                  <Option value="All">{t.fnoAllTypes}</Option>
                  <Option value="DataModel">DataModel</Option>
                  <Option value="ModelMapping">ModelMapping</Option>
                  <Option value="Format">Format</Option>
                </Dropdown>
                <Button size="small" onClick={selectAllVisible} disabled={filteredComponents.length === 0}>{t.fnoSelectAll}</Button>
                <Button size="small" onClick={clearSelection} disabled={selected.size === 0}>{t.fnoSelectNone}</Button>
              </div>
            </div>
            {filteredComponents.map(comp => {
              const key = componentKey(comp);
              return (
                <label key={key} className={styles.listItem}>
                  <Checkbox
                    checked={selected.has(key)}
                    onChange={() => toggleSelect(key)}
                    disabled={!comp.hasContent && !comp.revisionGuid && !comp.configurationGuid}
                  />
                  <div style={{ flex: 1 }}>
                    <Body1Strong>{comp.configurationName}</Body1Strong>
                    <div>
                      <Caption1>
                        {comp.componentType}
                        {comp.version ? ` · v${comp.version}` : ''}
                        {comp.countryRegion ? ` · ${comp.countryRegion}` : ''}
                      </Caption1>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {connState.kind === 'connected' && (
        <div className={styles.footer}>
          <Caption1>{selected.size > 0 ? `${selected.size} vybráno` : ''}</Caption1>
          <Button
            appearance="primary"
            icon={ingesting ? <ArrowSyncRegular /> : <CloudArrowDownRegular />}
            disabled={selected.size === 0 || ingesting}
            onClick={handleLoadSelected}
          >
            {ingesting ? t.fnoLoading : t.fnoLoadSelected}
          </Button>
        </div>
      )}
    </div>
  );
};

function componentKey(c: ErConfigSummary): string {
  return `${c.solutionName}::${c.configurationName}::${c.componentType}::${c.version ?? ''}`;
}

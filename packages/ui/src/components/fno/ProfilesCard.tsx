/**
 * The "Environments" card: the saved connection profiles, which one Connect
 * talks to, and the Connect / Disconnect, edit and remove actions per row.
 */

import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Caption1,
  Caption2,
  Body1Strong,
  Badge,
  Tooltip,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  DeleteRegular,
  EditRegular,
  PlugConnectedRegular,
  PlugDisconnectedRegular,
  AddRegular,
  ServerRegular,
  CopyRegular,
} from '@fluentui/react-icons';
import type { FnoConnection } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { useAppStore } from '../../state/store';
import type { ConnectionState } from '../../state/fno-session';
import { hasBuiltInClientId } from '../../fno/built-in-client';
import { useFnoPanelStyles } from './styles';

// ── Helper: profile initials avatar ─────────────────────────────────────
function initials(name: string): string {
  const parts = name.trim().split(/[\s·\-_]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export interface ProfilesCardProps {
  profiles: FnoConnection[];
  activeProfileId: string | null;
  connState: ConnectionState;
  /** Redirect URI to register (web build only; `''` otherwise). */
  redirectUri: string;
  setActiveProfileId: (id: string | null) => void;
  openNewProfile: () => void;
  openEditProfile: (p: FnoConnection) => void;
  handleRemoveProfile: (id: string) => void;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
}

export const ProfilesCard: React.FC<ProfilesCardProps> = ({
  profiles,
  activeProfileId,
  connState,
  redirectUri,
  setActiveProfileId,
  openNewProfile,
  openEditProfile,
  handleRemoveProfile,
  handleConnect,
  handleDisconnect,
}) => {
  const styles = useFnoPanelStyles();
  const pushToast = useAppStore(s => s.pushToast);
  // Removing a profile also drops its saved sign-in, so it asks first.
  const [pendingRemoval, setPendingRemoval] = useState<FnoConnection | null>(null);

  // ── Connection state derived values ──────────────────────────────────────
  const connDotClass =
    connState.kind === 'connected' ? styles.connStatusDotConnected :
    connState.kind === 'connecting' ? styles.connStatusDotConnecting :
    connState.kind === 'error' ? styles.connStatusDotError :
    styles.connStatusDotDisconnected;
  // `null` while disconnected: the row's own Connect button already says that,
  // and an extra "not connected" line would only add noise.
  const connStatusLabel =
    connState.kind === 'connected' ? t.fnoConnected(connState.account) :
    connState.kind === 'connecting' ? t.fnoConnecting :
    connState.kind === 'error' ? connState.message :
    null;
  const connStatusColor =
    connState.kind === 'connected' ? tokens.colorPaletteGreenForeground1 :
    connState.kind === 'error' ? tokens.colorPaletteRedForeground1 :
    tokens.colorNeutralForeground2;

  // Selecting a row picks the environment to connect to; editing lives on
  // an explicit pencil button and a modal, so the two actions can no
  // longer be confused with each other.
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderLeft}>
          <ServerRegular fontSize={18} className={styles.cardIcon} />
          <Body1Strong>{t.fnoProfiles}</Body1Strong>
          {profiles.length > 0 && (
            <Badge appearance="filled" color="brand" size="small">{profiles.length}</Badge>
          )}
        </div>
        {profiles.length > 0 && (
          <Button appearance="primary" size="small" icon={<AddRegular />} onClick={openNewProfile}>
            {t.fnoNewProfile}
          </Button>
        )}
      </div>

      {/* Deployment problem, not a user problem: without a registration baked
          into the build there is nothing to sign in with, so no profile can
          work. Say so up front instead of failing at Connect. */}
      {!hasBuiltInClientId && (
        <div className={styles.warningBox}>
          <Caption2 style={{ color: tokens.colorPaletteRedForeground1 }}>{t.fnoMissingBuiltInClientId}</Caption2>
          {redirectUri && (
            <div className={styles.redirectHintRow}>
              <code className={styles.redirectHintValue}>{redirectUri}</code>
              <Button
                size="small"
                appearance="subtle"
                icon={<CopyRegular />}
                onClick={() => {
                  navigator.clipboard?.writeText(redirectUri).then(
                    () => pushToast({ kind: 'success', message: t.fnoRedirectUriCopied }),
                    () => {},
                  );
                }}
              >
                {t.fnoRedirectUriCopy}
              </Button>
            </div>
          )}
        </div>
      )}

      {profiles.length === 0 ? (
        <div className={styles.profileEmptyState}>
          <ServerRegular fontSize={28} style={{ color: tokens.colorNeutralForeground3 }} />
          <Body1Strong>{t.fnoNoProfiles}</Body1Strong>
          <Caption1 style={{ color: tokens.colorNeutralForeground3, maxWidth: '420px' }}>
            {t.fnoNoProfilesHint}
          </Caption1>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={openNewProfile}
            style={{ marginTop: tokens.spacingVerticalS }}
          >
            {t.fnoNewProfile}
          </Button>
        </div>
      ) : (
        <div className={styles.profileList}>
          {profiles.map(p => {
            const isActive = activeProfileId === p.id;
            // Re-selecting the row that is already selected would drop a live
            // connection (setActiveProfileId resets the session) without ever
            // signing out — clicking the selected row is a no-op instead.
            const select = () => { if (!isActive) setActiveProfileId(p.id); };
            return (
              <div
                key={p.id}
                className={mergeClasses(styles.profileRow, isActive ? styles.profileRowActive : '')}
                onClick={select}
                role="button"
                aria-pressed={isActive}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') select(); }}
              >
                <div className={mergeClasses(styles.profileAvatar, isActive ? styles.profileAvatarActive : '')}>
                  {initials(p.displayName || p.envUrl)}
                </div>
                <div className={styles.profileMeta}>
                  <Body1Strong className={styles.profileLine}>{p.displayName}</Body1Strong>
                  <Caption1 className={styles.profileLine} style={{ color: tokens.colorNeutralForeground3 }}>
                    {p.envUrl}
                  </Caption1>
                  {isActive && connStatusLabel && (
                    <div className={styles.profileStatusRow}>
                      <span className={mergeClasses(styles.connStatusDot, connDotClass)} aria-hidden="true" />
                      <Caption1
                        className={styles.profileStatusText}
                        style={{ color: connStatusColor, fontStyle: connState.kind === 'connecting' ? 'italic' : undefined }}
                        role={connState.kind === 'error' ? 'alert' : 'status'}
                      >
                        {connStatusLabel}
                      </Caption1>
                    </div>
                  )}
                </div>
                <div className={styles.profileActions}>
                  {/* Connect acts on the selected environment, so it sits on that
                      row instead of in a second card repeating the same name. */}
                  {isActive && (connState.kind === 'connected' ? (
                    <Button
                      size="small"
                      className={styles.profileConnectBtn}
                      icon={<PlugDisconnectedRegular />}
                      onClick={e => { e.stopPropagation(); void handleDisconnect(); }}
                    >
                      {t.fnoDisconnect}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      appearance="primary"
                      className={styles.profileConnectBtn}
                      icon={connState.kind === 'connecting' ? <Spinner size="tiny" /> : <PlugConnectedRegular />}
                      disabled={connState.kind === 'connecting'}
                      onClick={e => { e.stopPropagation(); void handleConnect(); }}
                    >
                      {connState.kind === 'connecting' ? t.fnoConnecting : t.fnoConnect}
                    </Button>
                  ))}
                  <Tooltip content={t.fnoEditProfile} relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<EditRegular />}
                      aria-label={t.fnoEditProfile}
                      onClick={e => { e.stopPropagation(); openEditProfile(p); }}
                    />
                  </Tooltip>
                  <Tooltip content={t.fnoRemoveProfile} relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      aria-label={t.fnoRemoveProfile}
                      onClick={e => { e.stopPropagation(); setPendingRemoval(p); }}
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog
        open={pendingRemoval !== null}
        modalType="alert"
        onOpenChange={(_, d) => { if (!d.open) setPendingRemoval(null); }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t.fnoRemoveProfileConfirmTitle(pendingRemoval?.displayName || pendingRemoval?.envUrl || '')}</DialogTitle>
            <DialogContent>{t.fnoRemoveProfileConfirmBody}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setPendingRemoval(null)}>{t.cancel}</Button>
              <Button
                appearance="primary"
                icon={<DeleteRegular />}
                onClick={() => {
                  if (pendingRemoval) handleRemoveProfile(pendingRemoval.id);
                  setPendingRemoval(null);
                }}
              >
                {t.fnoRemoveProfile}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};

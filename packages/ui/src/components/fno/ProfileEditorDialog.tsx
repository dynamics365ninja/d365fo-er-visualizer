/**
 * Modal for creating or editing an F&O connection profile, plus the state
 * behind it (`useProfileEditor`).
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Field,
  Input,
  Caption1,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkCircleRegular } from '@fluentui/react-icons';
import type { FnoConnection } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { useAppStore } from '../../state/store';
import { useFnoProfiles, newProfileId } from '../../state/fno-profiles';
import { fnoSession } from '../../fno/session';
import { sameEnvUrl } from './listing';
import { useFnoPanelStyles } from './styles';

export interface ProfileEditorState {
  /** The form is open. */
  open: boolean;
  /** Profile being edited (null while creating a new one). */
  editorTarget: FnoConnection | null;
  profileName: string;
  envUrl: string;
  setProfileName: (value: string) => void;
  setEnvUrl: (value: string) => void;
  showUrlError: boolean;
  canSave: boolean;
  save: () => void;
  close: () => void;
}

/**
 * Editor state for connection profiles. Editing is deliberately decoupled
 * from `activeProfileId` (which only says *which environment Connect talks
 * to*) so that picking a profile never silently rewrites a half-typed form.
 */
export function useProfileEditor(
  activeProfileId: string | null,
  setActiveProfileId: (id: string | null) => void,
): {
  editor: ProfileEditorState;
  openNewProfile: () => void;
  openEditProfile: (p: FnoConnection) => void;
  /** Close the form if it is editing `id` (the profile was removed). */
  forgetProfile: (id: string) => void;
} {
  const pushToast = useAppStore(s => s.pushToast);
  const profiles = useFnoProfiles(s => s.profiles);
  const upsert = useFnoProfiles(s => s.upsert);

  // Editor target: `null` = closed, `{ id: null }` = creating, `{ id }` = editing
  // that profile.
  const [editor, setEditor] = useState<{ id: string | null } | null>(null);
  const [profileName, setProfileName] = useState('');
  const [envUrl, setEnvUrl] = useState('');

  // Profile being edited (null while creating a new one).
  const editorTarget = useMemo(
    () => (editor?.id ? profiles.find(p => p.id === editor.id) ?? null : null),
    [editor, profiles],
  );

  const openNewProfile = useCallback(() => {
    setProfileName('');
    setEnvUrl('');
    setEditor({ id: null });
  }, []);

  const openEditProfile = useCallback((p: FnoConnection) => {
    setProfileName(p.displayName);
    setEnvUrl(p.envUrl);
    setEditor({ id: p.id });
  }, []);

  const closeEditor = useCallback(() => setEditor(null), []);

  const forgetProfile = useCallback((id: string) => {
    // Leaving the dialog open on a profile that no longer exists would silently
    // turn an edit into a create.
    setEditor(prev => (prev?.id === id ? null : prev));
  }, []);

  const trimmedUrl = envUrl.trim().replace(/\/+$/, '');
  // Only flag a bad URL once the user has typed something — an empty field is
  // "not filled in yet", not an error.
  const urlLooksValid = /^https?:\/\/[^\s/?#]+/i.test(trimmedUrl);
  const showUrlError = trimmedUrl.length > 0 && !urlLooksValid;
  const canSave = profileName.trim().length > 0 && urlLooksValid;

  const handleSaveProfile = useCallback(() => {
    if (!canSave) return;
    const base: FnoConnection = editorTarget
      ? { ...editorTarget }
      : { id: newProfileId(), createdAt: Date.now(), displayName: '', envUrl: '' };
    const profile: FnoConnection = {
      ...base,
      displayName: profileName.trim(),
      envUrl: envUrl.trim().replace(/\/+$/, ''),
      // Sign-in always runs against the registration built into this app, so a
      // profile carries no Entra identifiers. Legacy profiles are migrated by
      // dropping the ones they were saved with.
      tenantId: undefined,
      clientId: undefined,
    };
    // The profile keeps its id across edits, so a token cached for the old
    // environment would otherwise be sent to the new one.
    const envChanged = !!editorTarget && !sameEnvUrl(editorTarget.envUrl, profile.envUrl);
    if (editorTarget) fnoSession.clearTokenCache(profile.id);
    upsert(profile);
    // Re-activating the already active profile would reset the connection
    // state (setActiveProfileId clears solutions/components) — only switch
    // when a different/new profile was saved, or when the active profile now
    // points at another environment and everything listed is stale.
    if (profile.id !== activeProfileId || envChanged) setActiveProfileId(profile.id);
    pushToast({
      kind: 'success',
      message: editorTarget ? t.fnoProfileUpdated(profile.displayName) : t.fnoProfileSaved(profile.displayName),
    });
    setEditor(null);
  }, [canSave, editorTarget, profileName, envUrl, upsert, pushToast, activeProfileId]);

  return {
    editor: {
      open: editor !== null,
      editorTarget,
      profileName,
      envUrl,
      setProfileName,
      setEnvUrl,
      showUrlError,
      canSave,
      save: handleSaveProfile,
      close: closeEditor,
    },
    openNewProfile,
    openEditProfile,
    forgetProfile,
  };
}

export const ProfileEditorDialog: React.FC<{ editor: ProfileEditorState }> = ({ editor }) => {
  const styles = useFnoPanelStyles();
  const {
    open, editorTarget, profileName, envUrl, setProfileName, setEnvUrl,
    showUrlError, canSave, save, close,
  } = editor;
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) close(); }}>
      <DialogSurface className={styles.dialogSurface}>
        <DialogBody>
          <DialogTitle>{editorTarget ? t.fnoEditProfileTitle : t.fnoNewProfileTitle}</DialogTitle>
          <DialogContent>
            <div className={styles.formStack}>
              <Field label={t.fnoProfileName} hint={t.fnoProfileNameHint}>
                <Input
                  className={styles.formInput}
                  value={profileName}
                  onChange={(_, d) => setProfileName(d.value)}
                  placeholder="CHE · Sandbox"
                />
              </Field>
              <Field
                label={t.fnoEnvUrl}
                hint={showUrlError ? undefined : t.fnoEnvUrlHint}
                validationState={showUrlError ? 'error' : 'none'}
                validationMessage={showUrlError ? t.fnoEnvUrlInvalid : undefined}
              >
                <Input
                  className={styles.formInput}
                  value={envUrl}
                  onChange={(_, d) => setEnvUrl(d.value)}
                  placeholder="https://org.sandbox.operations.dynamics.com"
                  onKeyDown={e => { if (e.key === 'Enter') save(); }}
                />
              </Field>
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{t.fnoSignInHint}</Caption1>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={close}>{t.fnoCancel}</Button>
            <Button
              appearance="primary"
              disabled={!canSave}
              icon={<CheckmarkCircleRegular />}
              onClick={save}
            >
              {editorTarget ? t.fnoUpdateProfile : t.fnoSaveProfile}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { DataBarVerticalFilled, DocumentFilled, LinkFilled } from '@fluentui/react-icons';
import { locale, t } from '../i18n';

export type DependencyKind = 'DataModel' | 'ModelMapping' | 'Format';

export interface DependencyCandidate {
  key: string;
  kind: DependencyKind;
  name: string;
  meta?: string;
}

export interface DependencyPromptRequest {
  /** Name of the configuration the user picked. */
  subjectName: string;
  subjectKind: DependencyKind;
  body?: string;
  candidates: DependencyCandidate[];
}

export function dependencyKindLabel(kind: DependencyKind | string | undefined): string {
  if (locale === 'cs') {
    return kind === 'DataModel' ? 'Datový model' : kind === 'ModelMapping' ? 'Mapování modelu' : kind === 'Format' ? 'Formát' : '?';
  }
  return kind === 'DataModel' ? 'Data model' : kind === 'ModelMapping' ? 'Model mapping' : kind === 'Format' ? 'Format' : '?';
}

export function DependencyKindIcon({ kind }: { kind: DependencyKind | string | undefined }) {
  if (kind === 'DataModel') return <DataBarVerticalFilled fontSize={14} />;
  if (kind === 'ModelMapping') return <LinkFilled fontSize={14} />;
  return <DocumentFilled fontSize={14} />;
}

/**
 * "Also load the data model and its mapping?" — shown when a format or mapping
 * is added to the workspace (from cache or from F&O) and its related
 * configurations are available but not yet loaded.
 */
export function DependencyPromptDialog({
  request,
  onConfirm,
  onOnlySubject,
  onCancel,
}: {
  request: DependencyPromptRequest | null;
  /** Called with the keys of the ticked candidates. */
  onConfirm: (keys: string[]) => void;
  onOnlySubject: () => void;
  onCancel?: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setChecked(new Set(request?.candidates.map(c => c.key) ?? []));
  }, [request]);

  if (!request) return null;

  const body = request.body ?? (
    request.subjectKind === 'Format'
      ? t.depPromptBodyFormat(request.subjectName)
      : request.subjectKind === 'ModelMapping'
        ? t.depPromptBodyMapping(request.subjectName)
        : t.depPromptBodyModel(request.subjectName)
  );

  const toggle = (key: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Dialog open modalType="alert" onOpenChange={(_, d) => { if (!d.open) (onCancel ?? onOnlySubject)(); }}>
      <DialogSurface className="dep-prompt">
        <DialogBody>
          <DialogTitle>{t.depPromptTitle}</DialogTitle>
          <DialogContent>
            <p className="dep-prompt__body">{body}</p>
            <ul className="dep-prompt__list">
              {request.candidates.map(c => (
                <li key={c.key} className={`dep-prompt__row dep-prompt__row--${c.kind.toLowerCase()}`}>
                  <Checkbox
                    checked={checked.has(c.key)}
                    onChange={() => toggle(c.key)}
                    label={(
                      <span className="dep-prompt__label">
                        <span className={`ws-kind ws-kind--${c.kind === 'DataModel' ? 'model' : c.kind === 'ModelMapping' ? 'mapping' : 'format'}`}>
                          <DependencyKindIcon kind={c.kind} />
                          {dependencyKindLabel(c.kind)}
                        </span>
                        <span className="dep-prompt__name">{c.name}</span>
                        {c.meta && <span className="dep-prompt__meta">{c.meta}</span>}
                      </span>
                    )}
                  />
                </li>
              ))}
            </ul>
          </DialogContent>
          <DialogActions>
            {onCancel && (
              <Button appearance="subtle" onClick={onCancel}>{t.depPromptCancel}</Button>
            )}
            <Button appearance="secondary" onClick={onOnlySubject}>{t.depPromptOnlyThis}</Button>
            <Button appearance="primary" disabled={checked.size === 0} onClick={() => onConfirm(Array.from(checked))}>
              {t.depPromptConfirm}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

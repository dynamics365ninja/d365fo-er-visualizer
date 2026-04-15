import React, { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

type LandingAccentTone = 'info' | 'success' | 'purple';

interface LandingPageProps {
  /** Called when user drops/selects files so App can switch to designer view */
  onFilesLoaded: () => void;
}

export function LandingPage({ onFilesLoaded }: LandingPageProps) {
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const configs = useAppStore(s => s.configurations);
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
        <div className="landing-hero-badge">D365 Finance &amp; Operations · Electronic Reporting</div>
        <h1 className="landing-hero-title">D365FO ER Visualizer</h1>
        <p className="landing-hero-sub">
          Přehledné pracovní místo pro konfigurace elektronického výkaznictví: modely, mapování i formáty na jednom místě.
          Snadno se proklikáš od formulí až ke zdrojovým tabulkám, dohledáš where-used vazby a přeskakuješ mezi souvisejícími soubory.
        </p>
      </div>

      {/* ── Drop Zone ── */}
      <div
        className={`landing-dropzone${isDragging ? ' dragging' : ''}`}
        onClick={handleOpenFiles}
        onKeyDown={e => e.key === 'Enter' && handleOpenFiles()}
        role="button"
        tabIndex={0}
        aria-label="Drop XML files here"
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
            <div className="landing-dropzone-primary">Načítání souborů…</div>
          </div>
        ) : (
          <div className="landing-dropzone-inner">
            <div className="landing-dropzone-icon">{isDragging ? '📥' : '📂'}</div>
            <div className="landing-dropzone-primary">
              {isDragging ? 'Pusť soubory' : 'Přetáhni ER XML soubory sem'}
            </div>
            <div className="landing-dropzone-secondary">nebo klikni pro výběr · můžeš načíst více souborů najednou</div>
            <div className="landing-dropzone-types">
              <span className="landing-type-pill landing-accent-info">📐 Model</span>
              <span className="landing-type-pill landing-accent-success">🔗 Mapování</span>
              <span className="landing-type-pill landing-accent-purple">📄 Formát</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Errors ── */}
      {errors.length > 0 && (
        <div className="landing-errors">
          <div className="landing-errors-title">⚠️ Chyby načítání</div>
          {errors.map((e, i) => (
            <div key={i} className="landing-error-item">{e}</div>
          ))}
          <button className="landing-error-dismiss" onClick={() => setErrors([])}>Zavřít</button>
        </div>
      )}

      {/* ── Already loaded ── */}
      {configs.length > 0 && (
        <div className="landing-loaded-bar">
          <span>✅ {configs.length} konfigurace načteny</span>
          <button className="landing-loaded-open" onClick={onFilesLoaded}>
            Přejít do návrháře →
          </button>
        </div>
      )}

      {/* ── Component Cards ── */}
      <div className="landing-cards">
        <ComponentCard
          accentTone="info"
          icon="📐"
          title="Data Model"
          subtitle="Abstraktní schéma dat"
          description="Hierarchická datová struktura ERP systému. Obsahuje kontejnery (záznamy, seznamy záznamů, výčty) a jejich pole s typy."
          features={[
            'Vizualizace jako hierarchický diagram',
            'Přehled polí a datových typů',
            'Navigace po vazbách typeDescriptor',
            'Barevné rozlišení root / record / enum',
          ]}
          fileHint="Tax declaration model.xml"
        />
        <ComponentCard
          accentTone="success"
          icon="🔗"
          title="Model Mapping"
          subtitle="Napojení modelu na D365 FO"
          description="Propojuje abstraktní model s konkrétními datovými zdroji D365 FO — tabulkami, pohledy, třídami, výčty a vypočtenými poli."
          features={[
            'Prohlížeč vazeb (model path ← výraz)',
            'Strom datových zdrojů',
            'Rozpad vypočtených polí krok za krokem',
            'Sledování závislostí na tabulky a třídy',
          ]}
          fileHint="Tax declaration model mapping.xml"
        />
        <ComponentCard
          accentTone="purple"
          icon="📄"
          title="Format"
          subtitle="Výstupní / vstupní soubor"
          description="Definuje strukturu výstupního (nebo vstupního) souboru. Podporuje XML, Excel, Word, PDF, CSV a plain-text formáty."
          features={[
            'Rozpoznání typu formátu (XML / Excel / Word / PDF / Text)',
            'Strom elementů včetně vložených formulí',
            'Proklik formule → datový zdroj → tabulka',
            'Přehled transformací a enumerací',
          ]}
          fileHint="VAT declaration XML (CZ).xml"
        />
      </div>

      {/* ── How it works ── */}
      <div className="landing-how">
        <div className="landing-section-title">Jak to funguje</div>
        <div className="landing-steps">
          <HowStep
            n={1}
            title="Načti soubory"
            desc="Přetáhni nebo vyber ER XML soubory. Nejlepší je načíst všechny tři typy (Model + Mapování + Formát), protože teprve pak funguje plný drill-down napříč konfigurací."
          />
          <HowStep
            n={2}
            title="Projdi strom konfigurace"
            desc="V levém panelu Exploreru vidíš hierarchii celé konfigurace. Kliknutím vybereš prvek, dvojklikem si otevřeš jeho vizualizaci na nové záložce."
          />
          <HowStep
            n={3}
            title="Klikni na formuli"
            desc="V pohledu Formát nebo Mapování klikni na libovolný výraz. Uvidíš celý řetězec vazeb: formule → vypočtená pole → zdrojová tabulka, třída nebo enum."
          />
          <HowStep
            n={4}
            title="Where-used"
            desc='V panelu 🔍 Hledat zadej název tabulky, třeba &quot;TaxTrans&quot;, a spusť &quot;Where used&quot;. Zobrazí se všechny formátové elementy, které z této tabulky čerpají data.'
          />
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="landing-footer">
        D365 FO ER Visualizer &nbsp;·&nbsp; Electronic Reporting Configuration Inspector
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

function HowStep({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="landing-step">
      <div className="landing-step-num">{n}</div>
      <div className="landing-step-body">
        <div className="landing-step-title">{title}</div>
        <div className="landing-step-desc" dangerouslySetInnerHTML={{ __html: desc }} />
      </div>
    </div>
  );
}

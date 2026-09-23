/**
 * Right column of the F&O browser: the configurations of the opened model
 * (or the hits of a cross-model search), with breadcrumb, type filter, text
 * filter and the selection checkboxes.
 */

import React from 'react';
import {
  Button,
  Input,
  Dropdown,
  Option,
  Checkbox,
  Spinner,
  Caption1,
  Body1Strong,
  Badge,
  Tooltip,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  CloudArrowDownRegular,
  SearchRegular,
  DocumentSearchRegular,
  DismissRegular,
  ChevronRightRegular,
  ChevronDownRegular,
  DocumentTableRegular,
  TableSimpleRegular,
  DismissCircleRegular,
  ArrowLeftRegular,
  SelectAllOffRegular,
  CheckboxCheckedRegular,
} from '@fluentui/react-icons';
import type { ErComponentType, ErConfigSummary } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { fnoUndownloadableReason } from '../../utils/fno-downloadable';
import { componentKey, isUsableGuid } from '../../fno/ingest/shared';
import { SkeletonListItem, TypeBadge, fnoComponentTypeLabel } from './common';
import type { DeepSearchState } from './listing';
import { useFnoPanelStyles } from './styles';

interface ComponentRowProps {
  comp: ErConfigSummary;
  checked: boolean;
  searchActive: boolean;
  toggleSelect: (comp: ErConfigSummary) => void;
  handleDrillInto: (comp: ErConfigSummary) => void;
  handlePickSolution: (solutionName: string) => void;
}

/** One listed configuration. */
const ComponentRow: React.FC<ComponentRowProps> = ({
  comp,
  checked,
  searchActive,
  toggleSelect,
  handleDrillInto,
  handlePickSolution,
}) => {
  const styles = useFnoPanelStyles();
  const ownerModel = comp.ownerDataModelName ?? comp.solutionName ?? '';
  const hasGuid = isUsableGuid(comp.revisionGuid) || isUsableGuid(comp.configurationGuid);
  const hasChildren = Boolean(comp.hasChildren);
  const canResolveMappingViaParent =
    comp.componentType === 'ModelMapping' &&
    Boolean(comp.parentDataModelGuid || comp.parentDataModelRevisionGuid);
  const undownloadable = fnoUndownloadableReason(comp);
  const isDownloadable = undownloadable === null;
  const isDead = !isDownloadable && !hasChildren;
  const isUnreachableMapping = undownloadable === 'unreachable-mapping';
  // The draft reason comes first: it is the one the user can
  // act on, by completing the version in F&O.
  const disabledTitle =
    undownloadable === 'draft-only' ? t.fnoDraftOnlyHint :
    isUnreachableMapping ? t.fnoUnreachableMapping :
    isDead ? t.fnoNoDownloadableContent :
    t.fnoBranchNodeHint;

  return (
    <div
      className={mergeClasses(
        styles.listItem,
        (isDead || isUnreachableMapping) ? styles.listItemDead : '',
      )}
    >
      {/* Checkbox */}
      <Checkbox
        checked={checked}
        disabled={!isDownloadable}
        title={isDownloadable ? undefined : disabledTitle}
        onChange={() => toggleSelect(comp)}
      />

      {/* Content */}
      <div
        className={styles.listItemContent}
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={hasChildren ? () => handleDrillInto(comp) : undefined}
        onKeyDown={hasChildren ? e => { if (e.key === 'Enter') handleDrillInto(comp); } : undefined}
        role={hasChildren ? 'button' : undefined}
        tabIndex={hasChildren ? 0 : undefined}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, flexWrap: 'wrap' }}>
          <TypeBadge type={comp.componentType} />
          {comp.countryRegion && (
            <Badge appearance="outline" size="small" style={{ fontSize: '10px' }}>
              {comp.countryRegion}
            </Badge>
          )}
          {canResolveMappingViaParent && !hasGuid && (
            <Badge appearance="outline" color="success" size="small" style={{ fontSize: '10px' }}>
              {t.fnoViaParent}
            </Badge>
          )}
          {/* No completed version: F&O will answer empty, so say
              it before the download rather than after. */}
          {comp.draftOnly && (
            <Tooltip content={t.fnoDraftOnlyHint} relationship="description">
              <Badge appearance="outline" color="warning" size="small" style={{ fontSize: '10px' }}>
                {t.fnoDraftOnly}
              </Badge>
            </Tooltip>
          )}

        </div>
        <Body1Strong style={{ display: 'block', marginTop: '2px' }}>
          {comp.configurationName}
        </Body1Strong>
        {comp.version && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>v{comp.version}</Caption1>
        )}
        {/* A hit pulled out of some other model is meaningless
            without its owner — and clicking it opens that model. */}
        {searchActive && ownerModel && (
          <button
            type="button"
            className={styles.resultOwner}
            title={t.fnoSearchOpenModel(ownerModel)}
            onClick={e => { e.stopPropagation(); void handlePickSolution(ownerModel); }}
          >
            <TableSimpleRegular fontSize={12} style={{ flexShrink: 0 }} />
            <span className={styles.resultOwnerName}>{ownerModel}</span>
          </button>
        )}
      </div>

      {/* Drill icon */}
      {hasChildren ? (
        <Tooltip content={t.fnoDrillInto} relationship="label">
          <ChevronRightRegular
            fontSize={16}
            style={{ color: tokens.colorBrandForeground1, flexShrink: 0, cursor: 'pointer' }}
            onClick={() => handleDrillInto(comp)}
          />
        </Tooltip>
      ) : isDownloadable ? (
        <CloudArrowDownRegular fontSize={14} style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
      ) : (
        <DismissCircleRegular fontSize={14} style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
      )}
    </div>
  );
};

export interface ConfigurationBrowserProps {
  solutionPath: string[];
  loadingSolutions: boolean;
  loadingComponents: boolean;
  search: DeepSearchState | null;
  clearSearch: () => void;
  componentTypeFilter: ErComponentType | 'All';
  setComponentTypeFilter: (value: ErComponentType | 'All') => void;
  componentFilter: string;
  setComponentFilter: (value: string) => void;
  /** Listed configurations after the type and text filters. */
  filteredComponents: ErConfigSummary[];
  selected: Map<string, ErConfigSummary>;
  selectAllVisible: () => void;
  clearSelection: () => void;
  toggleSelect: (comp: ErConfigSummary) => void;
  handleBack: () => void;
  handleDrillInto: (comp: ErConfigSummary) => void;
  handlePickSolution: (solutionName: string) => void;
}

export const ConfigurationBrowser: React.FC<ConfigurationBrowserProps> = ({
  solutionPath,
  loadingSolutions,
  loadingComponents,
  search,
  clearSearch,
  componentTypeFilter,
  setComponentTypeFilter,
  componentFilter,
  setComponentFilter,
  filteredComponents,
  selected,
  selectAllVisible,
  clearSelection,
  toggleSelect,
  handleBack,
  handleDrillInto,
  handlePickSolution,
}) => {
  const styles = useFnoPanelStyles();
  const searchActive = search !== null;
  return (
    <div className={styles.listBox}>
      <div className={styles.listHeader}>
        {/* Breadcrumb */}
        <div className={styles.listHeaderLeft} style={{ minWidth: 0, flex: 1 }}>
          {solutionPath.length > 0 && !searchActive && (
            <Tooltip content={t.fnoBack} relationship="label">
              <Button
                size="small"
                appearance="subtle"
                icon={<ArrowLeftRegular />}
                onClick={handleBack}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>
          )}
          <div className={styles.breadcrumb}>
            {searchActive ? (
              <>
                <DocumentSearchRegular fontSize={14} style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
                <Body1Strong className={styles.breadcrumbItem} title={search.query}>
                  {t.fnoSearchResults(search.query)}
                </Body1Strong>
              </>
            ) : solutionPath.length === 0 ? (
              <Body1Strong className={styles.breadcrumbItem}>{t.fnoConfigurations}</Body1Strong>
            ) : (
              solutionPath.map((seg, i) => (
                <React.Fragment key={seg}>
                  {i > 0 && <ChevronRightRegular fontSize={12} className={styles.breadcrumbSep} />}
                  <Caption1
                    className={styles.breadcrumbItem}
                    style={{ fontWeight: i === solutionPath.length - 1 ? '600' : undefined, color: i < solutionPath.length - 1 ? tokens.colorNeutralForeground3 : undefined }}
                    title={seg}
                  >
                    {seg}
                  </Caption1>
                </React.Fragment>
              ))
            )}
          </div>
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS, alignItems: 'center', flexShrink: 0 }}>
          {(loadingComponents || search?.running) && <Spinner size="tiny" />}
          {searchActive && (
            <Tooltip content={t.fnoSearchClear} relationship="label">
              <Button
                size="small"
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label={t.fnoSearchClear}
                onClick={clearSearch}
              />
            </Tooltip>
          )}
          <Dropdown
            size="small"
            value={componentTypeFilter === 'All' ? t.fnoAllTypes : fnoComponentTypeLabel(componentTypeFilter)}
            selectedOptions={[componentTypeFilter]}
            onOptionSelect={(_, d) => setComponentTypeFilter(d.optionValue as ErComponentType | 'All')}
          >
            <Option value="All">{t.fnoAllTypes}</Option>
            <Option value="ModelMapping">{fnoComponentTypeLabel('ModelMapping')}</Option>
            <Option value="Format">{fnoComponentTypeLabel('Format')}</Option>
          </Dropdown>
          <Tooltip content={t.fnoSelectAll} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<CheckboxCheckedRegular />}
              disabled={filteredComponents.length === 0}
              onClick={selectAllVisible}
            />
          </Tooltip>
          <Tooltip content={t.fnoSelectNone} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<SelectAllOffRegular />}
              disabled={selected.size === 0}
              onClick={clearSelection}
            />
          </Tooltip>
        </div>
      </div>

      {/* Narrows whatever the panel is showing: an opened model's
          configurations, or the hits of a cross-model search. */}
      <div className={styles.listSearchBar}>
        <Input
          size="small"
          placeholder={t.fnoFilterConfigurations}
          value={componentFilter}
          onChange={(_, d) => setComponentFilter(d.value)}
          contentBefore={<SearchRegular />}
          contentAfter={componentFilter ? (
            <DismissRegular
              fontSize={12}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label={t.dismiss}
              onClick={() => setComponentFilter('')}
            />
          ) : undefined}
          style={{ width: '100%' }}
        />
      </div>

      <div className={styles.listScroll}>
        {/* Skeleton while loading components */}
        {(loadingComponents || (search?.running && filteredComponents.length === 0)) && (
          <>
            <SkeletonListItem wide delay={0} />
            <SkeletonListItem delay={60} />
            <SkeletonListItem wide delay={120} />
          </>
        )}

        {!loadingComponents && filteredComponents.map(comp => {
          const key = componentKey(comp);
          return (
            <ComponentRow
              key={key}
              comp={comp}
              checked={selected.has(key)}
              searchActive={searchActive}
              toggleSelect={toggleSelect}
              handleDrillInto={handleDrillInto}
              handlePickSolution={handlePickSolution}
            />
          );
        })}

        {searchActive && !search.running && filteredComponents.length === 0 && (
          <div className={styles.emptyState}>
            <DocumentSearchRegular fontSize={32} style={{ opacity: 0.3 }} />
            <Caption1>{t.fnoSearchNoHits(componentFilter.trim() || search.query)}</Caption1>
          </div>
        )}
        {!searchActive && !loadingComponents && filteredComponents.length === 0 && solutionPath.length > 0 && (
          <div className={styles.emptyState}>
            <DocumentTableRegular fontSize={32} style={{ opacity: 0.3 }} />
            <Caption1>
              {componentFilter.trim()
                ? t.fnoSearchNoHits(componentFilter.trim())
                : t.fnoNoChildren(solutionPath[solutionPath.length - 1])}
            </Caption1>
          </div>
        )}
        {!searchActive && !loadingComponents && filteredComponents.length === 0 && solutionPath.length === 0 && !loadingSolutions && (
          <div className={styles.emptyState}>
            <ChevronDownRegular fontSize={32} style={{ opacity: 0.3 }} />
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {t.fnoPickModelHint}
            </Caption1>
          </div>
        )}
      </div>
    </div>
  );
};

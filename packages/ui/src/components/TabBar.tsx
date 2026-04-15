import React from 'react';
import { useAppStore } from '../state/store';

export function TabBar() {
  const tabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const closeTab = useAppStore(s => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="tab-label">{tab.label}</span>
          <button
            onClick={e => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            className="tab-close"
            aria-label={`Close ${tab.label}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

import {
  TabList,
  Tab,
  Button,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    background: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowX: 'auto',
    overflowY: 'hidden',
    minHeight: '36px',
  },
  list: {
    flex: 1,
  },
  tab: {
    position: 'relative',
    paddingRight: '28px',
  },
  closeBtn: {
    position: 'absolute',
    right: '2px',
    top: '50%',
    transform: 'translateY(-50%)',
    minWidth: '20px',
    height: '20px',
    padding: 0,
  },
});

export function TabBar() {
  const styles = useStyles();
  const tabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const closeTab = useAppStore(s => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className={styles.root}>
      <TabList
        className={styles.list}
        selectedValue={activeTabId ?? undefined}
        onTabSelect={(_, d) => setActiveTab(String(d.value))}
        size="small"
      >
        {tabs.map(tab => (
          <Tab key={tab.id} value={tab.id} className={styles.tab}>
            <span>{tab.label}</span>
            <Button
              as="a"
              appearance="transparent"
              size="small"
              icon={<DismissRegular />}
              aria-label={`Close ${tab.label}`}
              className={styles.closeBtn}
              onClick={e => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            />
          </Tab>
        ))}
      </TabList>
    </div>
  );
}

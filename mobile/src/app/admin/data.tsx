import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { AuditPanel } from '@/components/admin/data/audit-panel';
import { BrandsPanel } from '@/components/admin/data/brands-panel';
import { CategoriesPanel } from '@/components/admin/data/categories-panel';
import { ChannelLinkPanel } from '@/components/admin/data/channel-link-panel';
import { EditorialPanel } from '@/components/admin/data/editorial-panel';
import { FeedbackEmailPanel } from '@/components/admin/data/feedback-email-panel';
import { ItemsPanel } from '@/components/admin/data/items-panel';
import { LinkSuggestionsPanel } from '@/components/admin/data/link-suggestions-panel';
import { PendingPanel } from '@/components/admin/data/pending-panel';
import { PhotoCandidatesPanel } from '@/components/admin/data/photo-candidates-panel';
import { ProvidersPanel } from '@/components/admin/data/providers-panel';
import { ReportsPanel } from '@/components/admin/data/reports-panel';
import { UsersPanel } from '@/components/admin/data/users-panel';
import { ADMIN_DATA_TABS, DEFAULT_ADMIN_DATA_TAB, adminNavSectionTitle, isAdminDataTab } from '@/lib/admin/dataTabs';
import { OnePick } from '@/constants/onepick';

export default function AdminDataScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = isAdminDataTab(params.tab) ? params.tab : DEFAULT_ADMIN_DATA_TAB;
  const current = ADMIN_DATA_TABS.find((entry) => entry.key === tab) ?? ADMIN_DATA_TABS[0];

  return (
    <View style={styles.page}>
      {/* The sidebar lists every tab, grouped by section; this header names the open one. */}
      <View>
        <Text style={styles.section}>{adminNavSectionTitle(tab)}</Text>
        <Text style={adminStyles.pageTitle}>{current.label}</Text>
        <Text style={adminStyles.pageDescription}>{current.description}</Text>
      </View>

      {/* Remount on tab change so each panel starts from its own fresh load. */}
      <View key={tab}>
        {tab === 'feedback' && <FeedbackEmailPanel />}
        {tab === 'categories' && <CategoriesPanel />}
        {tab === 'brands' && <BrandsPanel />}
        {tab === 'providers' && <ProvidersPanel />}
        {tab === 'items' && <ItemsPanel />}
        {tab === 'channels' && <ChannelLinkPanel />}
        {tab === 'editorial' && <EditorialPanel />}
        {tab === 'pending' && <PendingPanel />}
        {tab === 'photos' && <PhotoCandidatesPanel />}
        {tab === 'links' && <LinkSuggestionsPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'audit' && <AuditPanel />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  section: { color: OnePick.hint, fontSize: 12, fontWeight: '800', marginBottom: 4 },
});


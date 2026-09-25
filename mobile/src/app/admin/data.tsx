import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { AuditPanel } from '@/components/admin/data/audit-panel';
import { BrandsPanel } from '@/components/admin/data/brands-panel';
import { CategoriesPanel } from '@/components/admin/data/categories-panel';
import { EditorialPanel } from '@/components/admin/data/editorial-panel';
import { ItemsPanel } from '@/components/admin/data/items-panel';
import { PendingPanel } from '@/components/admin/data/pending-panel';
import { ProvidersPanel } from '@/components/admin/data/providers-panel';
import { ReportsPanel } from '@/components/admin/data/reports-panel';
import { UsersPanel } from '@/components/admin/data/users-panel';
import { ADMIN_DATA_TABS, DEFAULT_ADMIN_DATA_TAB, isAdminDataTab } from '@/lib/admin/dataTabs';
import { OnePick } from '@/constants/onepick';

export default function AdminDataScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = isAdminDataTab(params.tab) ? params.tab : DEFAULT_ADMIN_DATA_TAB;
  const current = ADMIN_DATA_TABS.find((entry) => entry.key === tab) ?? ADMIN_DATA_TABS[0];

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>데이터 관리</Text>
        <Text style={adminStyles.pageDescription}>카테고리·브랜드·판매처·상품 마스터, 검수 대기, 사용자, 신고, 운영 기록을 한 곳에서 관리합니다.</Text>
      </View>

      <View accessibilityRole="tablist" style={styles.tabBar}>
        {ADMIN_DATA_TABS.map((entry) => {
          const active = entry.key === tab;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => router.setParams({ tab: entry.key })}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.tabHeader}>
        <Text style={adminStyles.sectionTitle}>{current.label}</Text>
        <Text style={[adminStyles.muted, styles.tabDescription]}>{current.description}</Text>
      </View>

      {/* Remount on tab change so each panel starts from its own fresh load. */}
      <View key={tab}>
        {tab === 'categories' && <CategoriesPanel />}
        {tab === 'brands' && <BrandsPanel />}
        {tab === 'providers' && <ProvidersPanel />}
        {tab === 'items' && <ItemsPanel />}
        {tab === 'editorial' && <EditorialPanel />}
        {tab === 'pending' && <PendingPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'audit' && <AuditPanel />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  tabBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderBottomWidth: 1, borderBottomColor: OnePick.border, paddingBottom: 10 },
  tab: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 8 },
  tabActive: { backgroundColor: OnePick.text },
  tabText: { color: OnePick.muted, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: OnePick.onAccent },
  tabHeader: { gap: 4 },
  tabDescription: { lineHeight: 19 },
});

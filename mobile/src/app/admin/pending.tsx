import { Redirect } from 'expo-router';

// Pending review lives in the 검수 대기 tab; this route only keeps old links working.
export default function AdminPendingRedirect() {
  return <Redirect href="/admin/data?tab=pending" />;
}

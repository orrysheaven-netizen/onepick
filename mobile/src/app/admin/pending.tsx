import { Redirect } from 'expo-router';

// The pending review UI lives in the 데이터 관리 page (검수 대기 tab). Keep this
// route so older links still land on the same reviewer workflow.
export default function AdminPendingRoute() {
  return <Redirect href="/admin/data?tab=pending" />;
}

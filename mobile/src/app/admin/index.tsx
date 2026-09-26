import { Redirect } from 'expo-router';

// `/admin` opens the dashboard. This lives in its own route, not in the admin
// layout: while the layout checks the session it renders no <Slot />, and the
// router reports `/admin` for every admin URL, so a layout-level redirect sent
// direct links such as /admin/data?tab=users to the dashboard.
export default function AdminIndex() {
  return <Redirect href="/admin/dashboard" />;
}

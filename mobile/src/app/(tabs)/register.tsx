import { Redirect } from 'expo-router';

// Native tab presses open the existing registration stack without selecting this tab.
// Direct navigation still reaches the same registration entry point.
export default function RegisterTab() {
  return <Redirect href="/pick/new" />;
}

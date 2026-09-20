const DEMO_USERNAME_PREFIX = 'demo_';

export function isDemoUsername(username?: string | null) {
  return typeof username === 'string' && username.trim().toLowerCase().startsWith(DEMO_USERNAME_PREFIX);
}

export function demoSharePrefix(username?: string | null) {
  return isDemoUsername(username) ? '[DEMO DATA] ' : '';
}

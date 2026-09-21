/**
 * Return a safe display host for a stored purchase URL.
 * The database already restricts stored values to HTTPS, but cards still fail
 * closed for malformed/unexpected rows instead of rendering a trustworthy label.
 */
export function purchaseHost(value: string | null | undefined) {
  const input = value?.trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

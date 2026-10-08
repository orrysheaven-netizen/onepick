// Keep app.json as the shared web/native baseline. Account-owned values are
// supplied only after the owner confirms them; an ordinary web build needs none.
module.exports = ({ config }) => {
  const bundleIdentifier = process.env.ONEPICK_IOS_BUNDLE_IDENTIFIER?.trim();
  const androidPackage = process.env.ONEPICK_ANDROID_PACKAGE?.trim();
  const projectId = process.env.ONEPICK_EAS_PROJECT_ID?.trim();
  const owner = process.env.ONEPICK_EXPO_OWNER?.trim();

  return {
    ...config,
    ...(bundleIdentifier ? { ios: { ...config.ios, bundleIdentifier } } : {}),
    ...(androidPackage ? { android: { ...config.android, package: androidPackage } } : {}),
    ...(owner ? { owner } : {}),
    ...(projectId
      ? { extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } } }
      : {}),
  };
};

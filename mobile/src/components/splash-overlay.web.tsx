// The web build has no native splash to fade out. Keep this module free of
// react-native-reanimated / react-native-worklets: the root layout imports it,
// so anything imported here lands in the chunk every route (Home included) loads.
export function AnimatedSplashOverlay() {
  return null;
}

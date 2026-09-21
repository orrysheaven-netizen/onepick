// The web page has no native splash screen to hand over from, so the overlay
// renders nothing here. Keeping this file free of animation imports matters:
// react-native-reanimated was the single largest dependency in the web bundle
// and this module was the only thing in it that reached the library.
export function AnimatedSplashOverlay() {
  return null;
}

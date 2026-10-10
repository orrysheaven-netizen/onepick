// Figma registration CTA clearance is measured from the device's bottom edge.
// SafeAreaView already reserves the physical bottom inset; do not count it twice.
export function registrationFooterPadding(referenceBottom: number, deviceBottom: number): number {
  const safeBottom = Number.isFinite(deviceBottom) ? Math.max(0, deviceBottom) : 0;
  return Math.max(0, referenceBottom - safeBottom);
}

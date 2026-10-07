// Minimal stand-in for the shared UI Icon in screen checks that stub '@/components/ui'.
// Renders a marker element so markup assertions can see which icon a control uses.
const React = require('react');

const Icon = ({ name, size = 'md' }) => React.createElement('i', { 'data-icon': name, 'data-size': size });

module.exports = { Icon };

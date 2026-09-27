/**
 * Type for `.svg` imports.
 *
 * react-native-svg-transformer turns each file into a component taking the usual
 * SvgProps, so `color`, `width` and `height` are set at the call site — which is why
 * every icon in assets/icons uses `currentColor` rather than a baked-in fill.
 */
declare module '*.svg' {
  import type React from 'react';
  import type { SvgProps } from 'react-native-svg';

  const content: React.FC<SvgProps>;
  export default content;
}

import type { Types } from '@cornerstonejs/core';

export interface ViewportInfo {
  current: number;
  total: number;
  ww: number;
  wc: number;
}

/** Extract slice index, total slices, and window width/center from any Cornerstone viewport. */
export function extractViewportInfo(vp: Types.IViewport): ViewportInfo {
  const props = vp.getProperties() as any;
  const { lower, upper } = props?.voiRange ?? { lower: 0, upper: 0 };
  const ww = upper - lower;
  const wc = lower + ww / 2;
  return {
    current: vp.getSliceIndex(),
    total: vp.getNumberOfSlices(),
    ww,
    wc,
  };
}

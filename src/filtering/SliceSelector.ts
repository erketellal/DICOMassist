import type { StudyMetadata, SeriesMetadata } from '../dicom/types';
import type { SelectionPlan } from '../llm/types';
import type { SelectedSlice } from './types';
import { logger } from '../utils/logger';

const MAX_SLICES = 20;

/**
 * Returns the imagePositionPatient index that varies between slices for a given plane.
 * Axial → z (index 2), Sagittal → x (index 0), Coronal → y (index 1)
 */
function varyingAxisIndex(plane: SeriesMetadata['anatomicalPlane']): number {
  switch (plane) {
    case 'sagittal': return 0;
    case 'coronal': return 1;
    case 'axial':
    case 'oblique':
    default: return 2;
  }
}

export function selectSlices(metadata: StudyMetadata, plan: SelectionPlan): SelectedSlice[] {
  // Find the target series by series number
  const series = metadata.series.find((s) => String(s.seriesNumber) === plan.targetSeries);
  if (!series) {
    // Fallback: use primary series
    const primary = metadata.series.find((s) => s.seriesInstanceUID === metadata.primarySeriesUID);
    if (!primary) return [];
    return selectFromSeries(primary, plan);
  }
  return selectFromSeries(series, plan);
}

function selectFromSeries(
  series: SeriesMetadata,
  plan: SelectionPlan,
): SelectedSlice[] {
  const [rangeStart, rangeEnd] = plan.sliceRange;
  const axisIdx = varyingAxisIndex(series.anatomicalPlane);

  // Filter slices within the instance number range
  const inRange = series.slices.filter(
    (s) => s.instanceNumber >= rangeStart && s.instanceNumber <= rangeEnd,
  );

  if (inRange.length === 0) {
    // Fallback: use all slices in the series
    return applyStrategy(series.slices, plan, axisIdx);
  }

  // Sort by instance number
  inRange.sort((a, b) => a.instanceNumber - b.instanceNumber);

  return applyStrategy(inRange, plan, axisIdx);
}

function applyStrategy(
  slices: import('../dicom/types').SliceMetadata[],
  plan: SelectionPlan,
  axisIdx: number,
): SelectedSlice[] {
  let selected: import('../dicom/types').SliceMetadata[];

  switch (plan.samplingStrategy) {
    case 'all':
      selected = [...slices];
      break;

    case 'every_nth': {
      const n = plan.samplingParam ?? 2;
      selected = slices.filter((_, i) => i % n === 0);
      break;
    }

    case 'uniform': {
      const count = Math.min(plan.samplingParam ?? 10, slices.length);
      if (count >= slices.length) {
        selected = [...slices];
      } else {
        selected = [];
        for (let i = 0; i < count; i++) {
          const idx = Math.round((i * (slices.length - 1)) / (count - 1));
          selected.push(slices[idx]);
        }
      }
      break;
    }

    default:
      selected = [...slices];
  }

  // Hard cap at MAX_SLICES — re-sample uniformly if over
  if (selected.length > MAX_SLICES) {
    logger.warn(`[SliceSelector] Hard cap: LLM selected ${selected.length} slices, resampling to ${MAX_SLICES}. Consider narrowing the slice range.`);
    const resampled: typeof selected = [];
    for (let i = 0; i < MAX_SLICES; i++) {
      const idx = Math.round((i * (selected.length - 1)) / (MAX_SLICES - 1));
      resampled.push(selected[idx]);
    }
    selected = resampled;
  }

  return selected.map((s) => ({
    imageId: s.imageId,
    instanceNumber: s.instanceNumber,
    sliceLocation: s.sliceLocation,
    zPosition: s.imagePositionPatient[axisIdx],
  }));
}

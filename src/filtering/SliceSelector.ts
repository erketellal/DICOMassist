import type { StudyMetadata, SeriesMetadata } from '../dicom/types';
import type { SelectionPlan, SeriesSelection } from '../llm/types';
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

interface SamplingParams {
  sliceRange: [number, number];
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;
}

/**
 * Select slices for a single SeriesSelection.
 */
export function selectSlicesForSelection(
  metadata: StudyMetadata,
  selection: SeriesSelection,
): SelectedSlice[] {
  const series = metadata.series.find((s) => String(s.seriesNumber) === selection.seriesNumber);
  if (!series) return [];
  return selectFromSeries(series, selection);
}

/**
 * Legacy entry point — selects slices using plan.targetSeries / plan.sliceRange (selections[0]).
 */
export function selectSlices(metadata: StudyMetadata, plan: SelectionPlan): SelectedSlice[] {
  const series = metadata.series.find((s) => String(s.seriesNumber) === plan.targetSeries);
  if (!series) {
    const primary = metadata.series.find((s) => s.seriesInstanceUID === metadata.primarySeriesUID);
    if (!primary) return [];
    return selectFromSeries(primary, plan);
  }
  return selectFromSeries(series, plan);
}

function selectFromSeries(
  series: SeriesMetadata,
  params: SamplingParams,
): SelectedSlice[] {
  const [rangeStart, rangeEnd] = params.sliceRange;
  const axisIdx = varyingAxisIndex(series.anatomicalPlane);

  const inRange = series.slices.filter(
    (s) => s.instanceNumber >= rangeStart && s.instanceNumber <= rangeEnd,
  );

  const slicesToSample = inRange.length === 0 ? [...series.slices] : inRange;
  slicesToSample.sort((a, b) => a.instanceNumber - b.instanceNumber);

  return applyStrategy(slicesToSample, params, axisIdx);
}

function applyStrategy(
  slices: import('../dicom/types').SliceMetadata[],
  params: SamplingParams,
  axisIdx: number,
  maxSlices: number = MAX_SLICES,
): SelectedSlice[] {
  let selected: import('../dicom/types').SliceMetadata[];

  switch (params.samplingStrategy) {
    case 'all':
      selected = [...slices];
      break;

    case 'every_nth': {
      const n = params.samplingParam ?? 2;
      selected = slices.filter((_, i) => i % n === 0);
      break;
    }

    case 'uniform': {
      const count = Math.min(params.samplingParam ?? 10, slices.length);
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

  // Hard cap — re-sample uniformly if over
  if (selected.length > maxSlices) {
    logger.warn(`[SliceSelector] Hard cap: ${selected.length} slices → resampling to ${maxSlices}`);
    const resampled: typeof selected = [];
    for (let i = 0; i < maxSlices; i++) {
      const idx = Math.round((i * (selected.length - 1)) / (maxSlices - 1));
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

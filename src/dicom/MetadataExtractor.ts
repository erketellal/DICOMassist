import type { DataSet } from 'dicom-parser';
import { detectPlaneFromOrientation } from './orientationUtils';
import type { SliceMetadata, SeriesMetadata, StudyMetadata } from './types';

/** Raw per-file metadata extracted during the parse pass. */
export interface RawFileRecord {
  instanceNumber: number;
  zPosition: number;
  imagePositionPatient: [number, number, number];
  imageOrientationPatient: [number, number, number, number, number, number];
  sliceLocation?: number;
  seriesInstanceUID: string;
  seriesNumber: number;
  seriesDescription: string;
  modality: string;
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  convolutionKernel?: string;
  windowCenter?: number;
  windowWidth?: number;
  studyDescription: string;
  bodyPartExamined?: string;
  patientAge?: string;
  patientSex?: string;
  studyDate?: string;
  institutionName?: string;
  // Assigned after sorting + fileManager registration
  imageId: string;
}

function parseFloatArray(value: string | undefined, count: number): number[] | undefined {
  if (!value) return undefined;
  const parts = value.split('\\').map(Number);
  if (parts.length < count || parts.some(isNaN)) return undefined;
  return parts.slice(0, count);
}

function optFloat(dataSet: DataSet, tag: string): number | undefined {
  const v = dataSet.string(tag);
  if (v == null) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

/**
 * Extract all relevant DICOM tags from a parsed DataSet.
 * Called during the existing parse loop in DicomDropZone — no extra file reads.
 */
export function extractFileMetadata(dataSet: DataSet): Omit<RawFileRecord, 'imageId'> {
  const ipp = parseFloatArray(dataSet.string('x00200032'), 3);
  const iop = parseFloatArray(dataSet.string('x00200037'), 6);

  const imagePositionPatient: [number, number, number] = ipp
    ? [ipp[0], ipp[1], ipp[2]]
    : [0, 0, 0];

  const imageOrientationPatient: [number, number, number, number, number, number] = iop
    ? [iop[0], iop[1], iop[2], iop[3], iop[4], iop[5]]
    : [1, 0, 0, 0, 1, 0];

  return {
    instanceNumber: dataSet.intString('x00200013') ?? 0,
    zPosition: imagePositionPatient[2],
    imagePositionPatient,
    imageOrientationPatient,
    sliceLocation: optFloat(dataSet, 'x00201041'),
    seriesInstanceUID: dataSet.string('x0020000e') ?? 'unknown',
    seriesNumber: dataSet.intString('x00200011') ?? 0,
    seriesDescription: dataSet.string('x0008103e') ?? '',
    modality: dataSet.string('x00080060') ?? 'unknown',
    sliceThickness: optFloat(dataSet, 'x00180050'),
    spacingBetweenSlices: optFloat(dataSet, 'x00180088'),
    convolutionKernel: dataSet.string('x00181210') ?? undefined,
    windowCenter: optFloat(dataSet, 'x00281050'),
    windowWidth: optFloat(dataSet, 'x00281051'),
    studyDescription: dataSet.string('x00081030') ?? '',
    bodyPartExamined: dataSet.string('x00180015') ?? undefined,
    patientAge: dataSet.string('x00101010') ?? undefined,
    patientSex: dataSet.string('x00100040') ?? undefined,
    studyDate: dataSet.string('x00080020') ?? undefined,
    institutionName: dataSet.string('x00080080') ?? undefined,
  };
}

/**
 * Group raw file records by series and build the full StudyMetadata object.
 * Records must already have imageId assigned (after fileManager registration).
 */
export function buildStudyMetadata(records: RawFileRecord[]): StudyMetadata {
  if (records.length === 0) {
    return { studyDescription: '', modality: 'unknown', primarySeriesUID: '', series: [] };
  }

  // Study-level: take from first record
  const first = records[0];

  // Group by Series Instance UID
  const seriesMap = new Map<string, RawFileRecord[]>();
  for (const rec of records) {
    const uid = rec.seriesInstanceUID;
    let list = seriesMap.get(uid);
    if (!list) {
      list = [];
      seriesMap.set(uid, list);
    }
    list.push(rec);
  }

  const series: SeriesMetadata[] = [];

  for (const [uid, recs] of seriesMap) {
    const rep = recs[0]; // representative file for series-level tags
    const iopStr = rep.imageOrientationPatient.join('\\');
    const plane = detectPlaneFromOrientation(iopStr);

    // Sort slices within series by z-position, fallback to instance number
    const allSameZ = recs.every((r) => r.zPosition === recs[0].zPosition);
    if (allSameZ) {
      recs.sort((a, b) => a.instanceNumber - b.instanceNumber);
    } else {
      recs.sort((a, b) => a.zPosition - b.zPosition);
    }

    const slices: SliceMetadata[] = recs.map((r) => ({
      instanceNumber: r.instanceNumber,
      imagePositionPatient: r.imagePositionPatient,
      imageOrientationPatient: r.imageOrientationPatient,
      sliceLocation: r.sliceLocation,
      imageId: r.imageId,
    }));

    // Compute z-coverage from sorted slices
    const zPositions = recs.map((r) => r.zPosition);
    const zMin = Math.min(...zPositions);
    const zMax = Math.max(...zPositions);
    const zCoverageInMm = Math.abs(zMax - zMin);

    // Compute instance number range
    const instanceNumbers = recs.map((r) => r.instanceNumber);
    const instanceNumberRange: [number, number] = [
      Math.min(...instanceNumbers),
      Math.max(...instanceNumbers),
    ];

    series.push({
      seriesInstanceUID: uid,
      seriesNumber: rep.seriesNumber,
      seriesDescription: rep.seriesDescription,
      modality: rep.modality,
      sliceThickness: rep.sliceThickness,
      spacingBetweenSlices: rep.spacingBetweenSlices,
      convolutionKernel: rep.convolutionKernel,
      windowCenter: rep.windowCenter,
      windowWidth: rep.windowWidth,
      anatomicalPlane: plane === 'axial' || plane === 'coronal' || plane === 'sagittal' ? plane : 'oblique',
      zMin,
      zMax,
      zCoverageInMm,
      instanceNumberRange,
      slices,
    });
  }

  // Sort series by series number
  series.sort((a, b) => a.seriesNumber - b.seriesNumber);

  // Identify primary series: axial with most slices, tie-break lowest series number.
  // Fallback to largest series if no axial series exists.
  const axialSeries = series.filter((s) => s.anatomicalPlane === 'axial');
  let primary: SeriesMetadata;
  if (axialSeries.length > 0) {
    primary = axialSeries.reduce((best, s) =>
      s.slices.length > best.slices.length ||
      (s.slices.length === best.slices.length && s.seriesNumber < best.seriesNumber)
        ? s
        : best
    );
  } else {
    primary = series.reduce((best, s) =>
      s.slices.length > best.slices.length ||
      (s.slices.length === best.slices.length && s.seriesNumber < best.seriesNumber)
        ? s
        : best
    );
  }

  return {
    studyDescription: first.studyDescription,
    bodyPartExamined: first.bodyPartExamined,
    modality: first.modality,
    patientAge: first.patientAge,
    patientSex: first.patientSex,
    studyDate: first.studyDate,
    institutionName: first.institutionName,
    primarySeriesUID: primary.seriesInstanceUID,
    series,
  };
}

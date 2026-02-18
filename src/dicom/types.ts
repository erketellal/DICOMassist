export interface SliceMetadata {
  instanceNumber: number;
  imagePositionPatient: [number, number, number];
  imageOrientationPatient: [number, number, number, number, number, number];
  sliceLocation?: number;
  imageId: string;
}

export interface SeriesMetadata {
  seriesInstanceUID: string;
  seriesNumber: number;
  seriesDescription: string;
  modality: string;
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  convolutionKernel?: string;
  windowCenter?: number;
  windowWidth?: number;
  anatomicalPlane: 'axial' | 'coronal' | 'sagittal' | 'oblique';
  zMin: number;
  zMax: number;
  zCoverageInMm: number;
  instanceNumberRange: [number, number];
  slices: SliceMetadata[];
}

export interface StudyMetadata {
  studyDescription: string;
  bodyPartExamined?: string;
  modality: string;
  patientAge?: string;
  patientSex?: string;
  studyDate?: string;
  institutionName?: string;
  primarySeriesUID: string;
  series: SeriesMetadata[];
}

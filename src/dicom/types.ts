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

  // Imaging parameters
  rows?: number;
  columns?: number;
  pixelSpacing?: [number, number];
  protocolName?: string;
  imageType?: string;

  // MRI-specific
  repetitionTime?: number;
  echoTime?: number;
  magneticFieldStrength?: number;
  estimatedWeighting?: string;

  // CT-specific
  kvp?: number;
  xrayTubeCurrent?: number;

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
  manufacturer?: string;
  manufacturerModelName?: string;
  primarySeriesUID: string;
  series: SeriesMetadata[];
}

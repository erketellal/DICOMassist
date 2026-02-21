import type { StudyMetadata, SeriesMetadata } from '../dicom/types';
import type { SelectionPlan, ViewportContext } from './types';

const DISCLAIMER =
  'IMPORTANT: This is a research/portfolio tool, NOT for clinical diagnosis. ' +
  'All findings are for educational and demonstration purposes only.';

function formatSeriesSummary(s: SeriesMetadata): string {
  const parts = [
    `Series #${s.seriesNumber}: "${s.seriesDescription || '(no description)'}"`,
    `Plane: ${s.anatomicalPlane}`,
    `${s.slices.length} slices (instance ${s.instanceNumberRange[0]}–${s.instanceNumberRange[1]})`,
  ];
  if (s.zCoverageInMm > 0) {
    parts.push(`z-coverage: ${s.zCoverageInMm.toFixed(1)}mm (z=${s.zMin.toFixed(1)} to ${s.zMax.toFixed(1)})`);
  }
  if (s.sliceThickness != null) parts.push(`thickness: ${s.sliceThickness}mm`);
  if (s.convolutionKernel) parts.push(`kernel: ${s.convolutionKernel}`);
  if (s.windowCenter != null && s.windowWidth != null) {
    parts.push(`preset W/L: W=${Math.round(s.windowWidth)} C=${Math.round(s.windowCenter)}`);
  }
  if (s.rows != null && s.columns != null) {
    let matrixStr = `matrix: ${s.rows}×${s.columns}`;
    if (s.pixelSpacing) matrixStr += ` @ ${s.pixelSpacing[0].toFixed(2)}×${s.pixelSpacing[1].toFixed(2)}mm`;
    parts.push(matrixStr);
  }
  if (s.estimatedWeighting) {
    let mriStr = s.estimatedWeighting;
    if (s.repetitionTime != null && s.echoTime != null) {
      mriStr += ` (TR:${Math.round(s.repetitionTime)} TE:${Math.round(s.echoTime)})`;
    }
    parts.push(mriStr);
  }
  if (s.kvp != null) {
    let ctStr = `${s.kvp}kV`;
    if (s.xrayTubeCurrent != null) ctStr += ` ${s.xrayTubeCurrent}mA`;
    parts.push(ctStr);
  }
  return parts.join(' | ');
}

function formatMetadataSummary(metadata: StudyMetadata): string {
  const lines: string[] = [
    '=== STUDY INFORMATION ===',
    `Study: ${metadata.studyDescription}`,
    `Modality: ${metadata.modality}`,
  ];
  if (metadata.bodyPartExamined) lines.push(`Body Part: ${metadata.bodyPartExamined} (note: ~15% error rate on this tag)`);
  if (metadata.patientAge) lines.push(`Patient Age: ${metadata.patientAge}`);
  if (metadata.patientSex) lines.push(`Patient Sex: ${metadata.patientSex}`);
  if (metadata.studyDate) {
    const d = metadata.studyDate;
    lines.push(`Study Date: ${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  }
  if (metadata.institutionName) lines.push(`Institution: ${metadata.institutionName}`);
  // Scanner line: compose from manufacturer, model, and field strength
  const scannerParts: string[] = [];
  if (metadata.manufacturer) scannerParts.push(metadata.manufacturer.trim());
  if (metadata.manufacturerModelName) scannerParts.push(metadata.manufacturerModelName.trim());
  const mrSeries = metadata.series.find((s) => s.modality === 'MR' && s.magneticFieldStrength);
  if (mrSeries?.magneticFieldStrength) scannerParts.push(`${mrSeries.magneticFieldStrength}T`);
  if (scannerParts.length > 0) lines.push(`Scanner: ${scannerParts.join(' ')}`);

  lines.push('', `=== AVAILABLE SERIES (${metadata.series.length}) ===`);
  for (const s of metadata.series) {
    lines.push(formatSeriesSummary(s));
  }

  return lines.join('\n');
}

export function buildSelectionSystemPrompt(): string {
  return [
    'You are a medical imaging AI assistant that helps select the most relevant DICOM slices for clinical analysis.',
    DISCLAIMER,
    '',
    'Given study metadata and a clinical hint, output a JSON object (no markdown fences) with these exact fields:',
    '- targetSeries: string — the Series Number (e.g. "3") of the best series for this clinical question',
    '- sliceRange: [number, number] — inclusive instance number range [start, end] covering the anatomical region of interest',
    '- samplingStrategy: "uniform" | "every_nth" | "all"',
    '- samplingParam: number — for "uniform": the TOTAL number of slices to pick (10-20). For "every_nth": pick every Nth slice. Omit for "all".',
    '- windowCenter: number — optimal window center for this clinical question',
    '- windowWidth: number — optimal window width for this clinical question',
    '- reasoning: string — brief explanation of your selections',
    '',
    'CRITICAL CONSTRAINT: We can only send a MAXIMUM of 20 images to the vision model.',
    '- ALWAYS use "uniform" with samplingParam between 10 and 20 for ranges with more than 20 slices.',
    '- Only use "all" if the slice range contains ≤20 slices.',
    '- Never set samplingParam above 20.',
    '- The vision model will see these sampled slices and analyze them — it will NOT see every slice.',
    '',
    'Guidelines:',
    '- Choose the series with the best plane, kernel, and resolution for the clinical question',
    '- Select a slice range that covers the anatomical region of interest (narrower is better — focus on where pathology is expected)',
    '- Use appropriate windowing (e.g., liver: W=150 C=70, lung: W=1500 C=-600, bone: W=2000 C=400, brain: W=80 C=40, soft tissue: W=400 C=40)',
    '- For lesion detection: narrow the sliceRange to the relevant organ rather than selecting the entire series',
    '- Output ONLY the JSON object, no other text',
  ].join('\n');
}

export function buildSelectionUserPrompt(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): string {
  const lines = [
    formatMetadataSummary(metadata),
    '',
  ];

  if (viewportContext) {
    lines.push('=== CURRENT VIEWPORT POSITION ===');
    lines.push(`The user is currently viewing Series #${viewportContext.seriesNumber}, slice #${viewportContext.currentInstanceNumber} of ${viewportContext.totalSlicesInSeries} (z=${viewportContext.currentZPosition.toFixed(1)}mm).`);
    lines.push('Center your slice selection around this position — the user has scrolled here because this region is clinically relevant.');
    lines.push('');
  }

  lines.push('=== CLINICAL QUESTION ===');
  lines.push(clinicalHint);
  lines.push('');
  lines.push('Based on the available series and the clinical question, provide your slice selection plan as a JSON object.');

  return lines.join('\n');
}

export function buildAnalysisSystemPrompt(): string {
  return [
    'You are a medical imaging AI assistant analyzing DICOM images.',
    DISCLAIMER,
    '',
    'Analyze the provided images in the context of the clinical question and study metadata.',
    'Structure your response clearly with:',
    '## Summary',
    'A concise overall assessment.',
    '',
    '## Findings',
    'List each finding as a bullet point.',
    '',
    '## Limitations',
    'Note any limitations of this analysis.',
    '',
    '## Suggested Follow-up',
    'If applicable, suggest follow-up studies or actions.',
    '',
    'Always note that this is NOT a clinical diagnosis and should be reviewed by a qualified radiologist.',
  ].join('\n');
}

export function buildAnalysisUserPrompt(
  metadata: StudyMetadata,
  clinicalHint: string,
  plan: SelectionPlan,
  sliceLabels: string[],
): string {
  const series = metadata.series.find((s) => String(s.seriesNumber) === plan.targetSeries);
  const totalSlices = series?.slices.length ?? sliceLabels.length;
  const lines = [
    `Clinical question: ${clinicalHint}`,
    '',
    `Study: ${metadata.studyDescription} | ${metadata.modality}`,
  ];
  if (metadata.patientAge) lines.push(`Patient: ${metadata.patientAge} ${metadata.patientSex ?? ''}`);
  lines.push('');
  if (series) {
    lines.push(`Viewing Series #${series.seriesNumber}: ${series.seriesDescription || '(no description)'}`);
    lines.push(`Plane: ${series.anatomicalPlane} | Kernel: ${series.convolutionKernel ?? 'N/A'}`);
    lines.push(`Total slices in series: ${totalSlices} (instance #${series.instanceNumberRange[0]}–#${series.instanceNumberRange[1]})`);
    if (series.zCoverageInMm > 0) {
      lines.push(`Full z-coverage: ${series.zCoverageInMm.toFixed(1)}mm (z=${series.zMin.toFixed(1)} to ${series.zMax.toFixed(1)})`);
    }
    if (series.sliceThickness != null) {
      lines.push(`Slice thickness: ${series.sliceThickness}mm`);
    }
    if (series.pixelSpacing) {
      lines.push(`In-plane resolution: ${series.pixelSpacing[0].toFixed(2)}×${series.pixelSpacing[1].toFixed(2)}mm`);
    }
    if (series.estimatedWeighting) {
      let weightLine = `MRI weighting: ${series.estimatedWeighting}`;
      if (series.repetitionTime != null && series.echoTime != null) {
        weightLine += ` (TR:${Math.round(series.repetitionTime)}ms TE:${Math.round(series.echoTime)}ms)`;
      }
      lines.push(weightLine);
    }
  }
  lines.push(`Window: W=${plan.windowWidth} C=${plan.windowCenter}`);
  lines.push(`Slice selection: instances #${plan.sliceRange[0]}–#${plan.sliceRange[1]}, ${plan.samplingStrategy}${plan.samplingParam ? ` (${plan.samplingParam})` : ''}`);
  lines.push(`Selection reasoning: ${plan.reasoning}`);
  lines.push('');
  lines.push(`IMPORTANT CONTEXT: You are viewing ${sliceLabels.length} sampled slices from a series of ${totalSlices} total slices. There are gaps between the images you see. A finding visible in one image may span more slices than shown. Account for this sampling when describing extent and when noting limitations.`);
  lines.push('');
  lines.push(`You are provided EXACTLY ${sliceLabels.length} images. Each image is labeled with its series name, slice number, and z-position.`);
  lines.push(`The images in order are:\n${sliceLabels.map((l, i) => `  ${i + 1}. ${l}`).join('\n')}`);
  lines.push('');
  lines.push(`When referencing findings, cite the slice number (e.g., "Slice 45/${totalSlices}") so the reader can navigate to it in the viewer.`);
  lines.push(`You may reference a range (e.g., "Slices 45–66/${totalSlices}").`);
  lines.push(`IMPORTANT: Only reference slice numbers from the list above. Do NOT invent or guess slice numbers that were not provided.`);
  lines.push('Please analyze these images in the context of the clinical question.');

  return lines.join('\n');
}

export function buildFollowUpSystemPrompt(): string {
  return [
    'You are a medical imaging AI assistant continuing a conversation about DICOM image analysis.',
    DISCLAIMER,
    '',
    'You previously analyzed medical images and provided findings.',
    'Continue the conversation by answering follow-up questions based on your prior analysis.',
    'You do not have access to the images anymore — rely on your prior observations.',
    'Be concise and helpful. If asked something outside the scope of your analysis, say so.',
  ].join('\n');
}

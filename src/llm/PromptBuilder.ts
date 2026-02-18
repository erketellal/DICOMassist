import type { StudyMetadata, SeriesMetadata } from '../dicom/types';
import type { SelectionPlan } from './types';

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
    '- sliceRange: [number, number] — inclusive instance number range [start, end]',
    '- samplingStrategy: "every_nth" | "uniform" | "all"',
    '- samplingParam: number — N for every_nth, count for uniform, omit for all',
    '- windowCenter: number — optimal window center for this clinical question',
    '- windowWidth: number — optimal window width for this clinical question',
    '- reasoning: string — brief explanation of your selections',
    '',
    'Guidelines:',
    '- Choose the series with the best plane, kernel, and resolution for the clinical question',
    '- Select a slice range that covers the anatomical region of interest',
    '- Use appropriate windowing (e.g., liver: W=150 C=70, lung: W=1500 C=-600, bone: W=2000 C=400, brain: W=80 C=40, soft tissue: W=400 C=40)',
    '- Target 10-20 slices total. Use "all" only if the range is ≤20 slices',
    '- Output ONLY the JSON object, no other text',
  ].join('\n');
}

export function buildSelectionUserPrompt(metadata: StudyMetadata, clinicalHint: string): string {
  return [
    formatMetadataSummary(metadata),
    '',
    `=== CLINICAL QUESTION ===`,
    clinicalHint,
    '',
    'Based on the available series and the clinical question, provide your slice selection plan as a JSON object.',
  ].join('\n');
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
  sliceCount: number,
): string {
  const series = metadata.series.find((s) => String(s.seriesNumber) === plan.targetSeries);
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
  }
  lines.push(`Window: W=${plan.windowWidth} C=${plan.windowCenter}`);
  lines.push(`Selection reasoning: ${plan.reasoning}`);
  lines.push('');
  lines.push(`${sliceCount} images are provided, ordered by slice position.`);
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

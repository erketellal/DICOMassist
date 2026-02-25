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
    '## Clinical Series Selection Guide',
    '',
    'When selecting the PRIMARY series for analysis, reason about which orientation',
    'and weighting is diagnostically standard for the clinical question:',
    '',
    '**Knee MRI:**',
    '- ACL/PCL tears → Sagittal PD fat-sat (primary), Coronal PD fat-sat (supplementary)',
    '- Meniscal tears → Sagittal PD fat-sat (primary), Coronal for body/root tears',
    '- Cartilage → Sagittal PD fat-sat or T2 mapping',
    '- Bone marrow edema → Any plane with fat-sat (STIR or PD-FS)',
    '',
    '**Brain MRI:**',
    '- Stroke → DWI/ADC (primary), FLAIR (supplementary)',
    '- Tumor → T1 post-contrast (primary), FLAIR, T2',
    '',
    '**Spine MRI:**',
    '- Disc herniation → Sagittal T2 (primary), Axial T2 at level of interest',
    '- Cord compression → Sagittal T2 (primary)',
    '',
    '**CT (any body part):**',
    '- Soft tissue evaluation → Soft tissue kernel, W:400 C:40',
    '- Lung evaluation → Lung kernel, W:1500 C:-600',
    '- Bone evaluation → Bone kernel, W:2000 C:400',
    '- Liver/abdomen → Soft tissue, portal venous phase if available',
    '',
    '**General rules:**',
    '- Fat-suppressed sequences (FS, STIR) highlight pathology better than non-FS',
    '- Higher resolution series (smaller pixel spacing) are preferred when available',
    '- PD-weighted fat-sat is the workhorse for musculoskeletal pathology',
    '- T1 is best for anatomy, T2/PD-FS is best for pathology detection',
    '- Choose the series where the structure of interest is BEST visualized,',
    '  not necessarily the series with the most slices',
    '- If the clinical question doesn\'t clearly map to a specific orientation, prefer',
    '  the series with the most slices in a standard orientation (axial for CT,',
    '  sagittal for knee/spine MRI)',
    '',
    '## Slice Range Selection',
    '',
    'Do NOT default to selecting the entire series. Reason about WHERE in the series',
    'the relevant anatomy is located:',
    '- For sagittal knee views: The ACL, PCL, and central structures are in the',
    '  MIDDLE THIRD of slices (roughly slices 13-26 of a 39-slice series)',
    '- For axial views: Select the range covering the anatomical region of interest',
    '- For spine sagittal: Select slices centered on the relevant vertebral levels',
    '',
    'A focused range of 10-15 slices through the relevant anatomy is BETTER than',
    '40 slices covering the entire field of view. The vision model analyzes each',
    'image — sending irrelevant slices dilutes the analysis quality.',
    '',
    'If you\'re unsure of the exact range, select the middle 50-70% of the series',
    'rather than the full range.',
    '',
    '## OUTPUT CONSTRAINTS (MANDATORY)',
    '',
    '- You MUST select a maximum of 20 slices for the final output',
    '- If your target range contains more than 20 slices, you MUST use a sampling',
    '  strategy to reduce to ≤20',
    '- The samplingParam in "uniform" mode means "select exactly this many slices',
    '  evenly spaced across the range"',
    '- Example: range 1-40 with uniform sampling, samplingParam=15 → 15 evenly',
    '  spaced slices from the range',
    '- NEVER set samplingStrategy to "all" if the range exceeds 20 slices',
    '',
    '## Output Format',
    '',
    'Output a JSON object (no markdown fences) with these exact fields:',
    '- targetSeries: string — the Series Number (e.g. "3"), pick the best diagnostic series',
    '- sliceRange: [number, number] — inclusive instance number range [start, end]',
    '- samplingStrategy: "uniform" | "every_nth" | "all" — MUST result in ≤20 slices',
    '- samplingParam: number — for "uniform": exact count (max 20). For "every_nth": step size. Omit for "all".',
    '- windowCenter: number — appropriate for the pathology being evaluated',
    '- windowWidth: number — appropriate for the pathology being evaluated',
    '- reasoning: string — explain: why this series, why this range, why this windowing',
    '',
    'Output ONLY the JSON object, no other text.',
  ].join('\n');
}

const SPATIAL_KEYWORDS = [
  'this slice', 'current slice', 'current view', 'this view',
  'what am i looking at', 'what is this', 'this area', 'right here',
  'this structure', 'this region', 'where i am',
];

export function buildSelectionUserPrompt(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): string {
  const lines = [
    formatMetadataSummary(metadata),
    '',
  ];

  // Only include viewport context when the user explicitly references their current view
  if (viewportContext) {
    const hintLower = clinicalHint.toLowerCase();
    const referencesViewport = SPATIAL_KEYWORDS.some((kw) => hintLower.includes(kw));
    if (referencesViewport) {
      lines.push('=== CURRENT VIEWPORT POSITION ===');
      lines.push(`The user is currently viewing Series #${viewportContext.seriesNumber}, slice #${viewportContext.currentInstanceNumber} of ${viewportContext.totalSlicesInSeries} (z=${viewportContext.currentZPosition.toFixed(1)}mm).`);
      lines.push('The user is referencing their current view — center your slice selection around this position.');
      lines.push('');
    }
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
    '',
    '## CRITICAL ANALYSIS RULES',
    '',
    '1. ONLY report findings you can clearly visualize on the provided images.',
    '   If you cannot see a structure clearly, say "not adequately visualized"',
    '   rather than guessing.',
    '',
    '2. For each finding, you MUST reference the specific slice(s) where you',
    '   see the finding. If you cannot point to a specific slice, do not',
    '   report the finding.',
    '',
    '3. Distinguish between definite, probable, and possible findings:',
    '   - DEFINITE: Clearly visible on images (e.g., "Complete fiber discontinuity',
    '     visible on slices 17-20")',
    '   - PROBABLE: Likely present but not unambiguous (e.g., "Probable partial',
    '     tear — signal abnormality on slice 18, but limited by slice sampling")',
    '   - POSSIBLE: Cannot confirm or exclude (e.g., "Possible meniscal tear —',
    '     cannot adequately assess on provided slices")',
    '',
    '4. If the provided slices do not adequately cover a structure, state this',
    '   explicitly rather than making assumptions. Example: "The lateral meniscus',
    '   is not well-visualized on the provided sagittal slices — coronal images',
    '   would be needed for adequate assessment."',
    '',
    '5. Always include a LIMITATIONS section noting:',
    '   - How many slices were analyzed out of the total series',
    '   - Any structures that could not be adequately assessed',
    '   - That this is a sample of the full dataset',
    '',
    '6. Do NOT fabricate normal findings just to be thorough. If you only',
    '   see the ACL clearly, only comment on the ACL. Don\'t add "PCL appears',
    '   intact" unless you can actually see it on the provided slices.',
    '',
    '7. When in doubt, err on the side of "cannot determine" rather than',
    '   making a definitive call. False confidence is worse than admitted',
    '   uncertainty.',
    '',
    '## RESPONSE FORMAT',
    '',
    '# [Modality] [Body Part] Analysis — [Clinical Question]',
    '',
    'DISCLAIMER: This is an educational analysis only and NOT a clinical diagnosis.',
    'All findings must be verified by a board-certified radiologist before any',
    'clinical decision-making.',
    '',
    '---',
    '',
    'SUMMARY',
    '[2-3 sentences. State the main finding with confidence level. If no clear',
    'pathology is identified, say so directly. If findings are equivocal, say so.]',
    '',
    'Conclusion: [One sentence definitive statement]',
    '',
    '---',
    '',
    'FINDINGS',
    '',
    '### [Primary Clinical Question]',
    '- [Finding with slice reference and confidence level]',
    '',
    '### Additional Observations',
    '- [Only findings clearly visible on images]',
    '',
    '### Limitations',
    '- Analyzed [X] of [Y] total slices in this series',
    '- [Any structures not adequately visualized]',
    '- [Any additional series that would help clarify findings]',
    '',
    '---',
    'Not for clinical diagnosis',
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
  const seriesDesc = series?.seriesDescription || '(no description)';
  const samplingDesc = `${plan.samplingStrategy}${plan.samplingParam ? ` (${plan.samplingParam})` : ''}`;

  const lines = [
    `Analyze ONLY the following ${sliceLabels.length} images from ${seriesDesc}.`,
    `These are slices ${plan.sliceRange[0]}–${plan.sliceRange[1]} of ${totalSlices} in the series, sampled at ${samplingDesc}.`,
    '',
    `Clinical question: ${clinicalHint}`,
    '',
    'Remember: Only report what you can clearly see. Reference specific slices for every finding. State limitations honestly.',
    '',
    `Study: ${metadata.studyDescription} | ${metadata.modality}`,
  ];
  if (metadata.patientAge) lines.push(`Patient: ${metadata.patientAge} ${metadata.patientSex ?? ''}`);
  lines.push('');
  if (series) {
    lines.push(`Viewing Series #${series.seriesNumber}: ${seriesDesc}`);
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
  lines.push(`Slice selection: instances #${plan.sliceRange[0]}–#${plan.sliceRange[1]}, ${samplingDesc}`);
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

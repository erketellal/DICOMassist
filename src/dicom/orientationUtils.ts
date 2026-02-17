export type AnatomicalPlane = 'axial' | 'sagittal' | 'coronal';

/**
 * Detect the acquisition plane from Image Orientation Patient (0020,0037).
 *
 * The tag contains 6 direction cosines: [rowX, rowY, rowZ, colX, colY, colZ].
 * The cross product of the row and column vectors gives the slice normal.
 * - Normal mostly along Z → Axial
 * - Normal mostly along X → Sagittal
 * - Normal mostly along Y → Coronal
 */
export function detectPlaneFromOrientation(iop: string | undefined): AnatomicalPlane {
  if (!iop) return 'axial'; // default assumption

  const parts = iop.split('\\').map(Number);
  if (parts.length < 6 || parts.some(isNaN)) return 'axial';

  const [rowX, rowY, rowZ, colX, colY, colZ] = parts;

  // Cross product: row × col = normal vector
  const nx = Math.abs(rowY * colZ - rowZ * colY);
  const ny = Math.abs(rowZ * colX - rowX * colZ);
  const nz = Math.abs(rowX * colY - rowY * colX);

  if (nz >= nx && nz >= ny) return 'axial';
  if (nx >= ny && nx >= nz) return 'sagittal';
  return 'coronal';
}

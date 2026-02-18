import { imageLoader } from '@cornerstonejs/core';
import type { SelectedSlice } from './types';

const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.85;

interface ExportedSlice {
  blob: Blob;
  instanceNumber: number;
  zPosition: number;
}

export async function exportSlicesToJpeg(
  slices: SelectedSlice[],
  windowCenter: number,
  windowWidth: number,
): Promise<ExportedSlice[]> {
  const results: ExportedSlice[] = [];

  for (const slice of slices) {
    const blob = await renderSliceToJpeg(slice.imageId, windowCenter, windowWidth);
    if (blob) {
      results.push({
        blob,
        instanceNumber: slice.instanceNumber,
        zPosition: slice.zPosition,
      });
    }
  }

  return results;
}

async function renderSliceToJpeg(
  imageId: string,
  windowCenter: number,
  windowWidth: number,
): Promise<Blob | null> {
  const image = await imageLoader.loadAndCacheImage(imageId);

  const { columns: width, rows: height } = image;
  const pixelData = image.getPixelData();

  // Get rescale parameters
  const slope = image.slope ?? 1;
  const intercept = image.intercept ?? 0;

  // Calculate window bounds
  const lower = windowCenter - windowWidth / 2;
  const upper = windowCenter + windowWidth / 2;

  // Create pixel buffer with windowing applied
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixelData.length; i++) {
    // Apply rescale slope/intercept to get Hounsfield units
    const hu = pixelData[i] * slope + intercept;

    // Apply windowing
    let val: number;
    if (hu <= lower) {
      val = 0;
    } else if (hu >= upper) {
      val = 255;
    } else {
      val = ((hu - lower) / windowWidth) * 255;
    }

    const offset = i * 4;
    rgba[offset] = val;
    rgba[offset + 1] = val;
    rgba[offset + 2] = val;
    rgba[offset + 3] = 255;
  }

  // Render to canvas
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  // Resize if needed (keep aspect ratio, max long edge = 1568px)
  const longEdge = Math.max(width, height);
  if (longEdge > MAX_LONG_EDGE) {
    const scale = MAX_LONG_EDGE / longEdge;
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);

    const resized = new OffscreenCanvas(newW, newH);
    const resizedCtx = resized.getContext('2d');
    if (!resizedCtx) return null;

    resizedCtx.drawImage(canvas, 0, 0, newW, newH);
    return resized.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }

  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}

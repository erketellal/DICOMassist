import {
  init as csRenderInit,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
} from '@cornerstonejs/core';
import { init as csToolsInit } from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

let initialized = false;

export async function initCornerstone(): Promise<void> {
  if (initialized) return;

  await csRenderInit();
  await csToolsInit();
  dicomImageLoaderInit({
    maxWebWorkers: navigator.hardwareConcurrency || 1,
  });

  volumeLoader.registerUnknownVolumeLoader(
    cornerstoneStreamingImageVolumeLoader as unknown as Parameters<typeof volumeLoader.registerUnknownVolumeLoader>[0]
  );

  initialized = true;
}

import { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';
import { detectPlaneFromOrientation, type AnatomicalPlane } from '../dicom/orientationUtils';

export interface LoadResult {
  imageIds: string[];
  primaryAxis: AnatomicalPlane;
}

interface DicomDropZoneProps {
  onFilesLoaded: (result: LoadResult) => void;
}

function isDicomFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.dcm') || !name.includes('.');
}

async function getAllFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const entries: FileSystemEntry[] = [];

  for (let i = 0; i < dataTransfer.items.length; i++) {
    const entry = dataTransfer.items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  async function readEntry(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve)
      );
      if (isDicomFile(file)) files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const subEntries = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve)
      );
      for (const sub of subEntries) {
        await readEntry(sub);
      }
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      await readEntry(entry);
    }
  } else {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i];
      if (isDicomFile(file)) files.push(file);
    }
  }

  return files;
}

export default function DicomDropZone({ onFilesLoaded }: DicomDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'reading' | 'sorting'>('reading');
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      setLoading(true);

      const files = await getAllFiles(e.dataTransfer);
      if (files.length === 0) {
        setLoading(false);
        return;
      }

      setLoadingPhase('reading');
      setProgress({ loaded: 0, total: files.length });

      // Parse headers to extract sort keys + detect orientation, then register with fileManager
      const parsed: { file: File; instanceNumber: number; zPosition: number }[] = [];
      let primaryAxis: AnatomicalPlane = 'axial';

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const arrayBuffer = await file.arrayBuffer();
          const byteArray = new Uint8Array(arrayBuffer);
          const dataSet = dicomParser.parseDicom(byteArray);

          const instanceNumber = dataSet.intString('x00200013') ?? 0;

          // Image Position Patient (0020,0032) — z-component is the 3rd value
          const ipp = dataSet.string('x00200032');
          const zPosition = ipp
            ? parseFloat(ipp.split('\\')[2] ?? '0')
            : 0;

          // Detect primary axis from first file's Image Orientation Patient
          if (i === 0) {
            const iop = dataSet.string('x00200037');
            primaryAxis = detectPlaneFromOrientation(iop);
          }

          parsed.push({ file, instanceNumber, zPosition });
        } catch {
          parsed.push({ file, instanceNumber: 0, zPosition: 0 });
        }
        setProgress({ loaded: i + 1, total: files.length });
      }

      setLoadingPhase('sorting');

      // Sort by z-position (Image Position Patient) — most reliable for spatial ordering.
      // Fall back to instance number if z-positions are all identical.
      const allSameZ = parsed.every((p) => p.zPosition === parsed[0]?.zPosition);
      if (allSameZ) {
        parsed.sort((a, b) => a.instanceNumber - b.instanceNumber);
      } else {
        parsed.sort((a, b) => a.zPosition - b.zPosition);
      }

      const imageIds = parsed.map((p) =>
        cornerstoneDICOMImageLoader.wadouri.fileManager.add(p.file)
      );

      setLoading(false);
      onFilesLoaded({ imageIds, primaryAxis });
    },
    [onFilesLoaded]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  if (loading) {
    const pct = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-neutral-400 text-sm">
          {loadingPhase === 'reading'
            ? `Reading DICOM headers... ${progress.loaded} / ${progress.total}`
            : `Sorting slices...`}
        </p>
        <div className="w-64 h-2 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-100"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg m-4 transition-colors cursor-pointer ${
        dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-neutral-700 hover:border-neutral-500'
      }`}
    >
      <Upload className="w-12 h-12 text-neutral-500 mb-4" />
      <p className="text-neutral-400 text-lg">Drop DICOM files or folder here</p>
      <p className="text-neutral-600 text-sm mt-2">Supports .dcm files and DICOM directories</p>
    </div>
  );
}

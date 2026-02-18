export type { SelectionPlan } from '../llm/types';

export interface SelectedSlice {
  imageId: string;
  instanceNumber: number;
  sliceLocation?: number;
  zPosition: number;
}

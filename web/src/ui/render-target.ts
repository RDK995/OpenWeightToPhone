import type { ViewModel } from "./view-model";

export interface RenderTarget {
  paint(view: ViewModel): void;
}

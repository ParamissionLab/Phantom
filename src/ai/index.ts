import { createPhantomAi, removeBackgroundAi } from "./browser-background.js";

export {
  BrowserBackgroundRemover,
  PHANTOM_AI_BACKGROUND_DEFAULTS,
  createAiBackgroundRemover,
  createPhantomAi,
  removeBackgroundAi,
  resolveAiMaskRefinementOptions,
  type AiBackend,
  type AiBackendPreference,
  type AiBackgroundRemovalOptions,
  type AiBackgroundRemovalResult,
  type AiBackgroundRemoverOptions,
  type AiMaskResult,
  type AiPreloadResult,
  type AiProgress,
  type BrowserImageInput,
} from "./browser-background.js";

export const ai = {
  removeBackground: removeBackgroundAi,
  create: createPhantomAi,
} as const;

export default ai;

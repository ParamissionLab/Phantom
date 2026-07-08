import { aiRemoveBackground, createAiRemover } from "./browser-background.js";

export {
  AI_BACKGROUND_DEFAULTS,
  BrowserBackgroundRemover,
  aiRemoveBackground,
  createAiRemover,
  normalizeAiMaskOptions,
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
  removeBackground: aiRemoveBackground,
  create: createAiRemover,
} as const;

export default ai;

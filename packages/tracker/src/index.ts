// Primary entry — used by bundlers (ESM / CJS). Keep this file tiny; no
// side-effects. The UMD entry that auto-initializes from script-tag
// attributes lives in `./umd.ts`.

export { init } from "./core.js";
export type { InitConfig, Tracker, CollectPayload, Transport } from "./types.js";
export { observeWebVitals } from "./vitals.js";
export type { VitalName, VitalSample } from "./vitals.js";

// Điểm vào của engine — dùng chung cho Node (CLI, test) và trình duyệt (Worker).
export { compileModel } from './compile.js';
export { simulate } from './simulate.js';
export { evaluateMonitor, evaluateMonitors, verdictOk, compileMonitorExpr } from './monitor.js';
export { requirementMatrix, transitionCoverage } from './coverage.js';
export { parseCSV, toCSV, resample, compareSignals } from './log.js';
export { applyOverrides, resolveRef, toDCM, parseDCM, mergeDCM, validateCalibration } from './calibration.js';
export { nelderMead, optimizeParams } from './optimize.js';
export { interp1, interp2, lookupCurve, lookupMap } from './lookup.js';
export { listBlockTypes, defineBlock } from './blocks/index.js';
export {
  loadProject, runScenario, runAll, compareWithLog, identifyFromLog, monitorsOnLog,
  makeFakeLog, checkProject, compileFor, findScenario,
} from './project.js';

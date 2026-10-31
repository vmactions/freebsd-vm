var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var src_exports = {};
__export(src_exports, {
  AzureLogger: () => AzureLogger,
  createClientLogger: () => createClientLogger,
  getLogLevel: () => getLogLevel,
  setLogLevel: () => setLogLevel
});
module.exports = __toCommonJS(src_exports);
var import_logger = require("@typespec/ts-http-runtime/internal/logger");
const context = (0, import_logger.createLoggerContext)({
  logLevelEnvVarName: "AZURE_LOG_LEVEL",
  namespace: "azure"
});
const AzureLogger = context.logger;
function setLogLevel(level) {
  context.setLogLevel(level);
}
function getLogLevel() {
  return context.getLogLevel();
}
function createClientLogger(namespace) {
  return context.createClientLogger(namespace);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AzureLogger,
  createClientLogger,
  getLogLevel,
  setLogLevel
});
//# sourceMappingURL=index.js.map

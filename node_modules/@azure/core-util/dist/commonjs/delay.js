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
var delay_exports = {};
__export(delay_exports, {
  delay: () => delay
});
module.exports = __toCommonJS(delay_exports);
var import_createAbortablePromise = require("./createAbortablePromise.js");
const StandardAbortMessage = "The delay was aborted.";
function delay(timeInMs, options) {
  let token;
  const { abortSignal, abortErrorMsg } = options ?? {};
  return (0, import_createAbortablePromise.createAbortablePromise)(
    (resolve) => {
      token = setTimeout(resolve, timeInMs);
    },
    {
      cleanupBeforeAbort: () => clearTimeout(token),
      abortSignal,
      abortErrorMsg: abortErrorMsg ?? StandardAbortMessage
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  delay
});
//# sourceMappingURL=delay.js.map

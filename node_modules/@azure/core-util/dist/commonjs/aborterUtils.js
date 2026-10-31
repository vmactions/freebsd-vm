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
var aborterUtils_exports = {};
__export(aborterUtils_exports, {
  cancelablePromiseRace: () => cancelablePromiseRace
});
module.exports = __toCommonJS(aborterUtils_exports);
async function cancelablePromiseRace(abortablePromiseBuilders, options) {
  const aborter = new AbortController();
  function abortHandler() {
    aborter.abort();
  }
  options?.abortSignal?.addEventListener("abort", abortHandler);
  try {
    return await Promise.race(
      abortablePromiseBuilders.map((p) => p({ abortSignal: aborter.signal }))
    );
  } finally {
    aborter.abort();
    options?.abortSignal?.removeEventListener("abort", abortHandler);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cancelablePromiseRace
});
//# sourceMappingURL=aborterUtils.js.map

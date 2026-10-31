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
var typeGuards_exports = {};
__export(typeGuards_exports, {
  isDefined: () => isDefined,
  isObjectWithProperties: () => isObjectWithProperties,
  objectHasProperty: () => objectHasProperty
});
module.exports = __toCommonJS(typeGuards_exports);
function isDefined(thing) {
  return typeof thing !== "undefined" && thing !== null;
}
function isObjectWithProperties(thing, properties) {
  if (!isDefined(thing) || typeof thing !== "object") {
    return false;
  }
  for (const property of properties) {
    if (!objectHasProperty(thing, property)) {
      return false;
    }
  }
  return true;
}
function objectHasProperty(thing, property) {
  return isDefined(thing) && typeof thing === "object" && property in thing;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isDefined,
  isObjectWithProperties,
  objectHasProperty
});
//# sourceMappingURL=typeGuards.js.map

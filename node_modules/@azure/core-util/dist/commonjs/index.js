var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var src_exports = {};
__export(src_exports, {
  calculateRetryDelay: () => calculateRetryDelay,
  cancelablePromiseRace: () => import_aborterUtils.cancelablePromiseRace,
  computeSha256Hash: () => computeSha256Hash,
  computeSha256Hmac: () => computeSha256Hmac,
  createAbortablePromise: () => import_createAbortablePromise.createAbortablePromise,
  delay: () => import_delay.delay,
  getErrorMessage: () => import_error.getErrorMessage,
  getRandomIntegerInclusive: () => getRandomIntegerInclusive,
  isBrowser: () => isBrowser,
  isBun: () => isBun,
  isDefined: () => import_typeGuards.isDefined,
  isDeno: () => isDeno,
  isError: () => isError,
  isNode: () => isNode,
  isNodeLike: () => isNodeLike,
  isNodeRuntime: () => isNodeRuntime,
  isObject: () => isObject,
  isObjectWithProperties: () => import_typeGuards.isObjectWithProperties,
  isReactNative: () => isReactNative,
  isWebWorker: () => isWebWorker,
  objectHasProperty: () => import_typeGuards.objectHasProperty,
  randomUUID: () => randomUUID,
  stringToUint8Array: () => stringToUint8Array,
  uint8ArrayToString: () => uint8ArrayToString
});
module.exports = __toCommonJS(src_exports);
var tspRuntime = __toESM(require("@typespec/ts-http-runtime/internal/util"));
var import_aborterUtils = require("./aborterUtils.js");
var import_createAbortablePromise = require("./createAbortablePromise.js");
var import_delay = require("./delay.js");
var import_error = require("./error.js");
var import_typeGuards = require("./typeGuards.js");
function calculateRetryDelay(retryAttempt, config) {
  return tspRuntime.calculateRetryDelay(retryAttempt, config);
}
function computeSha256Hash(content, encoding) {
  return tspRuntime.computeSha256Hash(content, encoding);
}
function computeSha256Hmac(key, stringToSign, encoding) {
  return tspRuntime.computeSha256Hmac(key, stringToSign, encoding);
}
function getRandomIntegerInclusive(min, max) {
  return tspRuntime.getRandomIntegerInclusive(min, max);
}
function isError(e) {
  return tspRuntime.isError(e);
}
function isObject(input) {
  return tspRuntime.isObject(input);
}
function randomUUID() {
  return tspRuntime.randomUUID();
}
const isBrowser = tspRuntime.isBrowser;
const isBun = tspRuntime.isBun;
const isDeno = tspRuntime.isDeno;
const isNode = tspRuntime.isNodeLike;
const isNodeLike = tspRuntime.isNodeLike;
const isNodeRuntime = tspRuntime.isNodeRuntime;
const isReactNative = tspRuntime.isReactNative;
const isWebWorker = tspRuntime.isWebWorker;
function uint8ArrayToString(bytes, format) {
  return tspRuntime.uint8ArrayToString(bytes, format);
}
function stringToUint8Array(value, format) {
  return tspRuntime.stringToUint8Array(value, format);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  calculateRetryDelay,
  cancelablePromiseRace,
  computeSha256Hash,
  computeSha256Hmac,
  createAbortablePromise,
  delay,
  getErrorMessage,
  getRandomIntegerInclusive,
  isBrowser,
  isBun,
  isDefined,
  isDeno,
  isError,
  isNode,
  isNodeLike,
  isNodeRuntime,
  isObject,
  isObjectWithProperties,
  isReactNative,
  isWebWorker,
  objectHasProperty,
  randomUUID,
  stringToUint8Array,
  uint8ArrayToString
});
//# sourceMappingURL=index.js.map

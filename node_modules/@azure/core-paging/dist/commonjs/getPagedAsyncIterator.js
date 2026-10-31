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
var getPagedAsyncIterator_exports = {};
__export(getPagedAsyncIterator_exports, {
  getPagedAsyncIterator: () => getPagedAsyncIterator
});
module.exports = __toCommonJS(getPagedAsyncIterator_exports);
function getPagedAsyncIterator(pagedResult) {
  const iter = getItemAsyncIterator(pagedResult);
  return {
    next() {
      return iter.next();
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    byPage: pagedResult.byPage ?? ((settings) => {
      const { continuationToken, maxPageSize } = settings ?? {};
      return getPageAsyncIterator(pagedResult, {
        pageLink: continuationToken,
        maxPageSize
      });
    })
  };
}
async function* getItemAsyncIterator(pagedResult) {
  const pages = getPageAsyncIterator(pagedResult);
  const firstVal = await pages.next();
  if (!Array.isArray(firstVal.value)) {
    const { toElements } = pagedResult;
    if (toElements) {
      yield* toElements(firstVal.value);
      for await (const page of pages) {
        yield* toElements(page);
      }
    } else {
      yield firstVal.value;
      yield* pages;
    }
  } else {
    yield* firstVal.value;
    for await (const page of pages) {
      yield* page;
    }
  }
}
async function* getPageAsyncIterator(pagedResult, options = {}) {
  const { pageLink, maxPageSize } = options;
  let response = await pagedResult.getPage(pageLink ?? pagedResult.firstPageLink, maxPageSize);
  if (!response) {
    return;
  }
  yield response.page;
  while (response.nextPageLink) {
    response = await pagedResult.getPage(response.nextPageLink, maxPageSize);
    if (!response) {
      return;
    }
    yield response.page;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getPagedAsyncIterator
});
//# sourceMappingURL=getPagedAsyncIterator.js.map

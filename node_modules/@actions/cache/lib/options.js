"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUploadOptions = getUploadOptions;
exports.getDownloadOptions = getDownloadOptions;
const core = __importStar(require("@actions/core"));
/**
 * Returns a copy of the upload options with defaults filled in.
 *
 * @param copy the original upload options
 */
function getUploadOptions(copy) {
    // Defaults if not overriden
    const result = {
        useAzureSdk: false,
        uploadConcurrency: 4,
        uploadChunkSize: 32 * 1024 * 1024
    };
    if (copy) {
        if (typeof copy.useAzureSdk === 'boolean') {
            result.useAzureSdk = copy.useAzureSdk;
        }
        if (typeof copy.uploadConcurrency === 'number') {
            result.uploadConcurrency = copy.uploadConcurrency;
        }
        if (typeof copy.uploadChunkSize === 'number') {
            result.uploadChunkSize = copy.uploadChunkSize;
        }
    }
    /**
     * Add env var overrides
     */
    // Cap the uploadConcurrency at 32
    result.uploadConcurrency = !isNaN(Number(process.env['CACHE_UPLOAD_CONCURRENCY']))
        ? Math.min(32, Number(process.env['CACHE_UPLOAD_CONCURRENCY']))
        : result.uploadConcurrency;
    // Cap the uploadChunkSize at 128MiB
    result.uploadChunkSize = !isNaN(Number(process.env['CACHE_UPLOAD_CHUNK_SIZE']))
        ? Math.min(128 * 1024 * 1024, Number(process.env['CACHE_UPLOAD_CHUNK_SIZE']) * 1024 * 1024)
        : result.uploadChunkSize;
    core.debug(`Use Azure SDK: ${result.useAzureSdk}`);
    core.debug(`Upload concurrency: ${result.uploadConcurrency}`);
    core.debug(`Upload chunk size: ${result.uploadChunkSize}`);
    return result;
}
/**
 * Returns a copy of the download options with defaults filled in.
 *
 * @param copy the original download options
 */
function getDownloadOptions(copy) {
    const result = {
        useAzureSdk: false,
        concurrentBlobDownloads: true,
        downloadConcurrency: 8,
        timeoutInMs: 30000,
        segmentTimeoutInMs: 600000,
        lookupOnly: false
    };
    if (copy) {
        if (typeof copy.useAzureSdk === 'boolean') {
            result.useAzureSdk = copy.useAzureSdk;
        }
        if (typeof copy.concurrentBlobDownloads === 'boolean') {
            result.concurrentBlobDownloads = copy.concurrentBlobDownloads;
        }
        if (typeof copy.downloadConcurrency === 'number') {
            result.downloadConcurrency = copy.downloadConcurrency;
        }
        if (typeof copy.timeoutInMs === 'number') {
            result.timeoutInMs = copy.timeoutInMs;
        }
        if (typeof copy.segmentTimeoutInMs === 'number') {
            result.segmentTimeoutInMs = copy.segmentTimeoutInMs;
        }
        if (typeof copy.lookupOnly === 'boolean') {
            result.lookupOnly = copy.lookupOnly;
        }
    }
    const segmentDownloadTimeoutMins = process.env['SEGMENT_DOWNLOAD_TIMEOUT_MINS'];
    if (segmentDownloadTimeoutMins &&
        !isNaN(Number(segmentDownloadTimeoutMins)) &&
        isFinite(Number(segmentDownloadTimeoutMins))) {
        result.segmentTimeoutInMs = Number(segmentDownloadTimeoutMins) * 60 * 1000;
    }
    core.debug(`Use Azure SDK: ${result.useAzureSdk}`);
    core.debug(`Download concurrency: ${result.downloadConcurrency}`);
    core.debug(`Request timeout (ms): ${result.timeoutInMs}`);
    core.debug(`Cache segment download timeout mins env var: ${process.env['SEGMENT_DOWNLOAD_TIMEOUT_MINS']}`);
    core.debug(`Segment download timeout (ms): ${result.segmentTimeoutInMs}`);
    core.debug(`Lookup only: ${result.lookupOnly}`);
    return result;
}
//# sourceMappingURL=options.js.map
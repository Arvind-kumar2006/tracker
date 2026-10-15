/**
 * Ports — interfaces the application layer depends on. Infrastructure implements them.
 * Keeping the app's use cases behind these is what lets the whole UI layer be exercised
 * without a device or a network.
 */

/**
 * @typedef {object} ApiGateway
 * @property {(month: string) => Promise<import('../shared/result.js').Result<object>>} getMetrics
 * @property {(month: string, opts?: {withData?: boolean}) => Promise<import('../shared/result.js').Result<Array>>} getDays
 * @property {(month: string) => Promise<import('../shared/result.js').Result<object>>} getPrecheck
 * @property {(month: string, opts?: {asOf?: string}) => Promise<import('../shared/result.js').Result<object>>} analyse
 * @property {(month: string) => Promise<import('../shared/result.js').Result<Array>>} getInsights
 * @property {(id: string, status: string) => Promise<import('../shared/result.js').Result<object>>} setInsightStatus
 * @property {(files: Array<{name: string, base64: string}>, opts?: object) => Promise<import('../shared/result.js').Result<object>>} uploadWorkbooks
 * @property {() => Promise<import('../shared/result.js').Result<object>>} health
 */

/**
 * @typedef {object} FileSystemGateway
 * @property {() => Promise<import('../shared/result.js').Result<{uri: string, name: string}>>} pickFolder
 * @property {(folderUri: string, opts?: {recursive?: boolean}) => Promise<import('../shared/result.js').Result<Array<{name: string, uri: string, size: number}>>>} listSpreadsheets
 * @property {(uri: string) => Promise<import('../shared/result.js').Result<string>>} readBase64
 */

/**
 * @typedef {object} OfflineQueue
 * @property {() => Promise<Array>} pending
 * @property {(op: object) => Promise<void>} enqueue
 * @property {() => Promise<number>} flush
 * @property {() => Promise<number>} size
 */

export {};
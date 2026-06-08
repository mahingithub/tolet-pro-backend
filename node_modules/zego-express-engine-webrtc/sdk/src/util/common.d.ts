import type { ZReporter, ZegoLogger, ZegoReportSpan } from '../common/zego.entity';
export declare const ZegoPromise: PromiseConstructor;
export declare const ZegoDocument: Document;
export declare function createVideoEle(width?: number, height?: number, autoplay?: boolean): HTMLVideoElement;
export declare function createAudioEle(mute: boolean): HTMLAudioElement;
export declare function createCanvasEle(width: number, height: number): HTMLCanvasElement;
export declare function actionCall(logger: ZegoLogger, action: string, content?: string): void;
export declare function actionEnd(logger: ZegoLogger, action: string, content?: string): void;
export declare function actionSuccess(logger: ZegoLogger, action: string, content?: string): void;
export declare function getRandomNumber(min: number, max: number): number;
export declare function getModuleErrorStr(moduleNames: Array<string>): string;
export declare function getModuleError(moduleNames: Array<string>, errorCode?: number): {
    errorCode: number;
    extendedData: string;
};
export declare function moduleRejectFn(moduleNames: Array<string>, errorCode?: number): Promise<{
    errorCode: number;
    extendedData: string;
}>;
export declare function longToNumber(long: any): number;
export declare function supplementPBInfo(body: any, key?: string): void;
export declare function checkIllegalCharacters(str: string): boolean;
export declare function checkStreamIDIllegalCharacters(str: string): boolean;
export declare function isUrl(str: string): boolean;
export declare function checkInteger(num: number | undefined, positive?: boolean): boolean;
export declare function getSpan(reporter: ZReporter, level: number, par: string, spanName: string, parentKey: string, otherParentKey?: string, isMap?: boolean): ZegoReportSpan;
export declare function updateSpanByLevel(reportLevel: number, span: ZegoReportSpan, attributes: {
    [key: string]: any;
}): void;
export declare function updateSpanByReporter(reporter: ZReporter, par: string, spanName: string, attributes?: any): void;
export declare function endSpanByReporter(reporter: ZReporter, par: string, spanName: string, attributes?: any, reverse?: boolean): void;
export declare function endSpanBySelf(span: ZegoReportSpan, attributes?: {
    [key: string]: any;
}, immediately?: boolean): void;
export declare function JSONStringify(obj: any): string;
export declare function JSONParse(obj: string): any;
export declare function ZegoSetTimeout(handler: TimerHandler, timeout?: number, ...args: any[]): number;
export declare function ZegoSetInterval(handler: TimerHandler, timeout?: number, ...args: any[]): number;
export declare function ZegoClearInterval(id: number | undefined): void;
export declare function ZegoClearIimeout(id: number | undefined): void;
export declare const getRandomValues: () => Promise<number>;
/**
 * @description 生成转码模版流后缀
 * @param {number} templateID 只有内部测试的才会设置为 0，对外设置的都是要大于100
 * @param {string} [codecTemplatePostfixPattern] 柔性配置返回的 "_zegom{codecid}"
 * @returns {*}  {string}
 */
export declare function createCodecSuffix(templateID?: number, codecTemplatePostfixPattern?: string): string;
export declare function debounce(func: Function, wait?: number): Function;
export declare function smartDebounce(func: Function, immediateThreshold: number, debounceDelay?: number): {
    (...args: any[]): any;
    setThreshold: (val: number) => void;
};
export declare function promiseDebounce(func: Function, immediateThreshold: number, debounceDelay?: number): {
    (...args: any[]): Promise<any>;
    setThreshold: (val: number) => void;
};
export declare function getSDKVersionNumber(version: string): number;
export declare function dateNow(): number;
export declare function dateTime(): number;
export declare function performanceTime(): number;

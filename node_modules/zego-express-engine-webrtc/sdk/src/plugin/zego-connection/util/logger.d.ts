export declare class ZegoLogger {
    constructor();
    level: ENUM_LOG_LEVEL;
    setLogLevel(level: 'debug' | 'info' | 'warn' | 'error' | 'report' | 'disable'): boolean;
    log(...values: string[]): void;
    debug(...values: string[]): void;
    info(...values: string[]): void;
    warn(...values: string[]): void;
    error(...values: string[]): void;
}
export declare const enum ENUM_LOG_LEVEL {
    debug = 0,
    info = 1,
    warn = 2,
    error = 3,
    report = 99,
    disable = 100
}
export declare function testLog(content: string): void;
export declare function DebugLog(content: string): void;

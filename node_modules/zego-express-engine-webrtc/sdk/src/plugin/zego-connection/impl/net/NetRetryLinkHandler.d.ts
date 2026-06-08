/// <reference types="node" />
import { StateCenter } from '../stateCenter';
import { ZegoLogger } from '../../util/logger';
import { ZegoWssLink } from './ZegoWssLink';
export declare class NetRetryLinkHandler {
    protected _logger: ZegoLogger;
    protected _stateCenter: StateCenter;
    RETRY_START_TIME_INTERVAL: number;
    RETRY_CONTINUE_COUNT: number;
    RETRY_MAX_TIME_INTERVAL: number;
    retryTimer: NodeJS.Timeout | null | number;
    maxTimer: NodeJS.Timeout | null | number;
    private _retryActiveCount;
    private _retryActiveInterval;
    /**用于检测网络进行重试 */
    private _retryNetCount;
    /**用于检测网络重试最大次数 */
    private _retryNetMaxTimes;
    isOverTime: boolean;
    link: ZegoWssLink;
    RETRY_MAX_TIME: number;
    h3ClosedTimes: number[];
    private retryIPMaxTimes;
    constructor(_logger: ZegoLogger, _stateCenter: StateCenter);
    initLink(link: ZegoWssLink): void;
    startMaxTime(): void;
    stopMaxTime(): void;
    active(isNext?: boolean, isFirst?: boolean, isSelf?: boolean): boolean;
    onactive(...args: any[]): void;
    onRetryBeyondLimit(): void;
    init(retryMaxTime?: number, startTimeInterval?: number, retryContinuteCount?: number, maxTimeInterval?: number): void;
    invalid(): void;
}

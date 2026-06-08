/// <reference types="node" />
import { LinkType, StreamType, ZegoConnectServiceEvent } from '../../entity/AccessHubDefine';
import { AccessHubMessageType } from '../../entity/AccessHubDefine';
import { WebTransportError } from '../../entity/http3';
import { ZegoLogger } from '../../util/logger';
import { SpeedUtil } from '../../util/speedUtil';
import { EventManager } from '../../util/EventManager';
import { StateCenter } from '../stateCenter';
export declare class NetSocketService {
    private _stateCenter;
    private _zgp_logger;
    private proxyCtrl?;
    private _socket;
    ENV: number;
    server: string;
    type: LinkType;
    eventManager: EventManager;
    _maxConnectTimer: NodeJS.Timeout | null | number;
    retryTimer: NodeJS.Timeout | null | number;
    _zgp_speedCount: SpeedUtil;
    get speed(): number;
    constructor(_stateCenter: StateCenter, _zgp_logger: ZegoLogger, proxyCtrl?: any);
    createSocket(server: string, type: LinkType, maxConnectInterval: number): void;
    bindSocketHandler(): void;
    startConnectCheck(maxConnectInterval: number): void;
    resetConnectTimer(): void;
    responseHandler(): void;
    closeSocket(): void;
    isNotConnected(): boolean;
    sendMessage(msg: ArrayBuffer, streamId: number, type: AccessHubMessageType, streamType: StreamType): void;
    onBackToWebSocket(reason: WebTransportError, error: any): void;
    closeStream(streamID: number): void;
    hasStream(streamID: number): boolean;
    /**
     * 注册长连接回调
     * @param event 事件名
     * @param callBack 回调函数
     * @returns
     */
    on<K extends keyof ZegoConnectServiceEvent>(event: K, callBack: ZegoConnectServiceEvent[K]): boolean;
    /**
     * 删除长连接回调
     * @param event 事件名
     * @param callBack 回调函数
     * @returns
     */
    off(event: string, callBack?: Function): void;
}

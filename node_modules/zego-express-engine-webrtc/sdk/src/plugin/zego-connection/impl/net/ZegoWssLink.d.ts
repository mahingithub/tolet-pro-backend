/// <reference types="node" />
import { LinkedList, ListNode } from '../../entity/linkNode';
import { AccessHubMessageType, DestroyType, ERROR, IPProbeState, IPStackDetection, IPStackType, LinkType, StreamType, ServerGroup, ConnectServerInfo } from '../../entity/AccessHubDefine';
import { AccessHubProtoBuf } from '../../protocol/AccessHubProtoBuf';
import { NetSocketService } from './NetSocketService';
import { StateCenter } from '../stateCenter';
import { ZegoLogger } from '../../util/logger';
import { WebTransportError } from '../../entity/http3';
import { NetHeartBeatHandler } from '../NetHeartBeatHandler';
import { ZegoSocketDetectManager } from './ZegoSocketDetectManager';
type MessageItem = {
    data: any;
    txid: number;
    sendTime: number;
    timeOut: number;
    ack: boolean;
    type: AccessHubMessageType;
    streamID: number;
    success: Function | null;
    error: Function | null;
    ackFunc: Function | null;
    isSend: boolean;
    isCheck: boolean;
    streamType: StreamType;
};
export declare class ZegoWssLink {
    private _protobuf;
    protected _stateCenter: StateCenter;
    private proxyCtrl?;
    txid: number;
    linkRetryTime: number;
    updatedMsgTime: number;
    connectServer: string;
    socketService: NetSocketService | null;
    ipStackRules: IPStackType[];
    socketDetectManager: ZegoSocketDetectManager;
    urlIndex: number;
    servers: string[];
    http3Servers: string[];
    byPassUrlIndex: number;
    _byPassProbeDetectState: IPProbeState;
    serversGroup: ServerGroup;
    unUpdateMsgTimeTypes: AccessHubMessageType[];
    netLinkState: number;
    sendCommandList: LinkedList<MessageItem>;
    unSendCommandList: LinkedList<MessageItem>;
    sendCommandMap: {
        [index: number]: ListNode<MessageItem>;
    };
    unSendCommandMap: {
        [index: number]: ListNode<MessageItem>;
    };
    private _sendDataCheckOnceCount;
    private _sendDataDropTimeout;
    private _sendDataCheckTimer;
    private _sendDataCheckInterval;
    private _timeout;
    private _onConnectedEvent;
    private _onConnectingEvent;
    private _onDisConnectedEvent;
    private _onPushEvent;
    connectInterval: number;
    connectRsp: {
        suc?: Function;
        fail?: Function;
    };
    unlogTypes: number[];
    tryServers: string[];
    connectStartTime: number;
    isTestedWebTransport: {
        0: boolean;
        1: boolean;
    };
    msgCache: {
        [index: number]: {
            streamID: number;
            data: Uint8Array;
        };
    };
    private _startConnectTime;
    _byPassProbeTimer: NodeJS.Timeout | number | null;
    _byPassProbeTime: number;
    _byPassServer: string;
    get linkServerStorageKey(): string;
    get byPassStackType(): IPStackType;
    get _logger(): ZegoLogger;
    get speed(): number;
    constructor(_protobuf: AccessHubProtoBuf, _stateCenter: StateCenter, proxyCtrl?: any);
    setIPStackDetectedInfo(connectSvrInfo: ConnectServerInfo): void;
    private _HBHandler;
    set HBHandler(handler: NetHeartBeatHandler);
    initEvent(onConnectedEvent: (servers: string[], errorCode: number) => void, onDisConnectedEvent: (isReconnect: boolean) => void, onConnectingEvent: (isReconnect: boolean) => void, onPushEvent: (streamID: number, msgType: number, msg: any, extras?: any) => void, onBackToWebSocket: (reason: WebTransportError, error: any) => void, onIPDetectEvent: (ipSupports: IPStackDetection) => void): void;
    onSocketClose(): void;
    setServers(wssServers?: string[], http3Servers?: string[], wssV6Servers?: string[], http3V6Servers?: string[]): void;
    setHttp3Servers(http3Servers: string[], http3V6Servers: string[]): void;
    setIpStrategy(rules: IPStackType[]): void;
    setLinkServers(): void;
    isNeedTestWebTransport(testServers: string[], ipStackType: IPStackType): boolean;
    destroySocket(type: DestroyType, error?: ERROR): void;
    refreshServers(servers: string[]): void;
    isEnableHttp3(): boolean;
    connectSocket(isNext?: boolean, success?: Function, failCB?: Function): boolean;
    _onOnceConnect(eventTag: number, server?: string, errorCode?: number, h3Reason?: number, errInfo?: any): void;
    getServersByStackType(ipStackType: IPStackType): string[][];
    getConnectServers(): {
        mainSvrInfo: ConnectServerInfo;
        byPassSvrInfo: ConnectServerInfo | undefined;
    };
    _getServerAndType(wssServers: string[], http3Servers: string[], ipStackType: IPStackType, index: number, type: string): ConnectServerInfo;
    private _setIPDetectResult;
    getByPassIp(service: NetSocketService, connectSvrInfo: ConnectServerInfo): void;
    closeCallback(type: 'close' | 'error', err: any): void;
    _socketServiceOpenHandler: () => void;
    _socketServiceCloseHandler: (err: any) => void;
    _socketServiceErrorHandler: (err: any) => void;
    _socketServiceTimeoutHandler: () => void;
    _triggerSocketFailHandler(err: any): void;
    bindSocketServiceEvent(): void;
    removeSocketServiceEvent(): void;
    releaseSocketDetectTask(): void;
    private _onSocketServiceOpen;
    closeSocket(): boolean;
    release(): void;
    isConnect(): boolean;
    isDisConnect(): boolean;
    isConnecting(): boolean;
    setState(state: number): void;
    sendMessage(type: AccessHubMessageType, streamID: number, body: any, isFirst: boolean | undefined, success: Function | null | undefined, error: Function | null | undefined, ackFunc: Function | null | undefined, option: {
        timeout?: number | undefined;
        isInSendMap?: boolean | undefined;
        extras?: any;
        isMsgCache?: boolean | undefined;
    } | undefined, streamType: StreamType): void;
    checkUnSendMsgs(messageList: LinkedList<MessageItem>, messageMap: {
        [index: number]: ListNode<MessageItem>;
    }): void;
    clearUnsentMsgs(streamID: number): void;
    private _Uint8ToArrayBuffer;
    private sendUint8Data;
    private notifyMessage;
    onMessage(): void;
    isRspMsg(txid: number): boolean;
    startCheck(): void;
    stopCheck(): void;
    private _checkMessageListTimeout;
    private _checkSendMessageList;
    private clearMessageList;
    protected handleSendCommandMsgRsp(msgType: number, txid: number, body: any, extras?: any): void;
    private _onBackToWebSocket;
    private _onIPDetectEvent;
    private _getStorageKey;
    onUpdateMsgTimeChanged: ((time: number) => void) | undefined;
    _sendGetConfigRequest(linkType: LinkType): {
        buf: ArrayBuffer;
        streamID: number;
        type: AccessHubMessageType;
    };
    /**
     * @description 获取可用的 http3 server
     * @returns {*}  {string}
     */
    getUseableHttp3Server(servers: string[], ipStackType: IPStackType): string;
    /**
     * @description 获取需要测试的 http3 server
     * @param {string[]} servers 调度返回的 servers
     * @returns {*}  {string[]}
     */
    private _getNeedTestHttp3Serves;
    testWebTransport(servers: string[], ipStackType: IPStackType): void;
    /**
     * @description 检测 http3Server 是否可用
     * 1. 连接 WebTransport
     * 2. 连接成功后发送 getConfig 请求
     * 3. 获取配置成功后关闭连接, 并且更新缓存
     * 4. 递归调用检测, 直到所有 server 都检测完毕或者有可用的 server
     */
    private startTestHttp3Server;
}
export {};

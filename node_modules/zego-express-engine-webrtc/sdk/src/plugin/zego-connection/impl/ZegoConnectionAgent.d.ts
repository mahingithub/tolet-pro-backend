import { BusinessService, AppInfo, HttpReq, PCOption, HttpReq2, ISettingConfig } from '../entity/AccessHubDefine';
import { AccessHubProtoBuf } from '../protocol/AccessHubProtoBuf';
import { ZegoWssLink } from './net/ZegoWssLink';
import { NetAgentBusinessRequestMgr } from './NetAgentBusinessRequestMgr';
import { HeartBeatMode, NetHeartBeatHandler } from './NetHeartBeatHandler';
import { NetAgentPCRequestMgr } from './PCMgr/NetAgentPCRequestMgr';
import { EventManager } from '../util/EventManager';
import { NetRetryLinkHandler } from './net/NetRetryLinkHandler';
import { StateCenter } from './stateCenter';
import { ZegoLogger } from '../util/logger';
import { StreamManager } from './stream/StreamManager';
import { NetAgentPCRequest } from './PCMgr/NetAgentPCRequest';
export declare class ZegoConnectionAgent {
    private proxyCtrl?;
    protobuf: AccessHubProtoBuf;
    zegoLink: ZegoWssLink;
    private _linkCheckTimer;
    businessRequestMgr: NetAgentBusinessRequestMgr;
    netHeartBeatHandler: NetHeartBeatHandler;
    netAgentPCRequestMgr: NetAgentPCRequestMgr;
    streamManager: StreamManager;
    connectServers: string[];
    http3Servers: string[];
    wssV6Servers: string[];
    http3V6Servers: string[];
    specifiedServers: string[];
    eventManager: EventManager;
    retryLinkHandler: NetRetryLinkHandler | undefined;
    getAppConfigFailCount: number;
    getAppConfigTime: number;
    logger: ZegoLogger;
    stateCenter: StateCenter;
    linkMsgMaxInterval: number;
    connectedTime: number;
    connectid: string;
    reportSeq: number;
    connectSeq: number;
    _onceConnectSeq: number;
    listenNetworkState: boolean;
    defaultConnectServers: string[];
    _linkConnectState: number;
    lastLinkConnectState: number;
    constructor(proxyCtrl?: any);
    _onLinkEvent(): void;
    get speed(): number;
    get isDestroy(): boolean;
    private get _useNetAgent();
    get clientIP(): string;
    get timeOffset(): number;
    get connectIPStackType(): number;
    get linkConnectState(): number;
    set linkConnectState(val: number);
    get appInfo(): AppInfo;
    /**
     * 初始化
     * 如果调用了Destroy，不能再调用次函数再次初始化
     */
    init(): void;
    /**
     * 反初始化
     * 销毁实例请使用destroy
     */
    unInit(): void;
    /**
     * 设置 app 信息
     * @param info
     */
    setAppInfo(appInfo: AppInfo): void;
    private checkAndConnect;
    /**
     * 设置 user 信息
     * @param userId
     */
    setUserInfo(userId: string): void;
    /**
     * 在连接前传递配置信息（例如云控配置）
     * @param config
     */
    setSettingConfig(config: ISettingConfig): void;
    /**
     * 设置统一接入默认连接地址，外部传入多个域名（默认域名及备用域名）；
     * 首次设置 hardcode 域名且未设置调度域名时能设置成功
     * @param servers 默认wss v4 域名地址
     *
     */
    setNetAgentDefaultServers(servers: string[], wssV6Servers?: string[]): void;
    /**
     * @deprecated 设置隔离域名 server 地址，风险客户使用，在废弃 im 域名方案后不再使用该接口
     * @param servers
     */
    setNetAgentSpecifiedServers(servers: string[]): void;
    /**
     * @deprecated 设置主备用域名的主域名，在调度结果返回时进行替换, 已废弃已不再使用
     * @param primaryDomains
     */
    setBackupDomains(primaryDomains: string[]): void;
    /**
     * 设置调度连接 servers, 调用此接口会覆盖setNetAgentDefaultServers的设置, 并马上发起连接
     * @param servers 调度域名地址
     * @param http3Servers 调度域名http3地址
     * @param wssV6Servers v6 的 wss 调度域名地址
     * @param http3V6Servers v6 的 https 调度域名地址
     */
    setDispatchConnectServers(servers: string[], http3Servers?: string[], wssV6Servers?: string[], http3V6Servers?: string[]): void;
    /**
     * 发起http请求，短连接代理
     * @param params 请求参数
     * @param sucFunc 成功回调
     * @param errFunc 失败回调
     * @param ackFunc 接入服务收到回调
     */
    startHttpRequest(req: HttpReq, sucFunc?: Function | null, errFunc?: Function | null, ackFunc?: Function | null, option?: {
        timeout?: number;
    }): void;
    /**
     * 发起http请求，短连接代理
     * @param params 请求参数
     * @param sucFunc 成功回调
     * @param errFunc 失败回调
     * @param ackFunc 接入服务收到回调
     */
    startHttpRequest2(req: HttpReq2, sucFunc?: Function | null, errFunc?: Function | null, ackFunc?: Function | null, option?: {
        timeout?: number;
        extras?: any;
    }): void;
    /**
     * 获取柔性配置
     * @param type 柔性配置类型
     * @param token 鉴权 token
     * @param timeout 超时时间
     * @returns
     */
    getAppConfigByAgent(type: string, token: string, timeout?: number, etag?: number, options?: {
        isSpecial?: boolean;
    }): Promise<any>;
    /**
     * 获取长连接代理请求
     * @param service 后端服务
     * @param option 附加参数
     * @returns
     */
    getPCRequest(service: BusinessService, option?: PCOption): NetAgentPCRequest;
    connectUa(): void;
    destroyConnect(error?: {
        code: number;
        msg: string;
    }): void;
    destroy(): void;
    /**
     * 是否连接状态
     * @returns
     */
    isConnect(): boolean;
    isDisConnect(): boolean;
    /**
     * 注册回调监听
     * @param event 事件
     * @param callBack 方法
     * @returns
     */
    on(event: string, callBack: Function): boolean;
    /**
     * 移除事件监听
     * @param event 事件
     * @param callBack 方法
     */
    off(event: string, callBack?: Function): void;
    setLogger(logger: any): void;
    setAccess(isAccess: boolean): void;
    getVersion(): string;
    reconnectUA(): void;
    private _heartBeatHandler;
    private _bindWindowListener;
    private _bindWxListener;
    private _netOnLineHandle;
    private _netOffLineHandle;
    private _checkLinkMsg;
    private _connect;
    private _connectByIPDetection;
    private resetIPDetection;
    private _onBackToWebSocket;
    private _detectIP;
    private _onIPDetectEvent;
    private _resetNetAgent;
    private _onConnectedEvent;
    private _onConnectingEvent;
    private _getConfig;
    private _onGetConfigSuccess;
    private _dispatch;
    private _getSvrAddr;
    private _handleGroups;
    private _getConnectionDomains;
    private _getAppConfig;
    private _onDisConnectedEvent;
    private _reportDisConnectEvent;
    private _onPushEvent;
    private _redirect;
    private _connectClosed;
    private _netOnLineHandler;
    private _netOffLineHandler;
    private innerReconnect;
    private _connectStart;
    private _reportConnectEventStart;
    private _reportConnectEventEnd;
    private _disConnect;
    getNetworkTimeInfo(): {
        timestamp: number;
        maxDeviation: number;
    };
    setHeartBeatMode(mode: HeartBeatMode): void;
    /**
     *
     * 设置本地日志级别
     *
     * */
    setLogLevel(level: 'debug' | 'info' | 'warn' | 'error' | 'report' | 'disable'): boolean;
    private getIpConnectRule;
}

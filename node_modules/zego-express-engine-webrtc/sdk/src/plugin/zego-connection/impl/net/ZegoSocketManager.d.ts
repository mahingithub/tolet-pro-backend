/// <reference types="node" />
import { ConnectServerInfo, IPProbeState, IPStackType, StackDetection } from '../../entity/AccessHubDefine';
import { ZegoLogger } from '../../util/logger';
import { StateCenter } from '../stateCenter';
import { NetSocketService } from './NetSocketService';
import { WebTransportError } from "../../entity/http3";
export declare class ZegoSocketManager {
    private _stateCenter;
    private _logger;
    private proxyCtrl?;
    ipStackRules: IPStackType[];
    _mainService: NetSocketService;
    _byPassProbeService: NetSocketService;
    _byPassProbeTime: number;
    _byPassProbeTimer: NodeJS.Timeout | null | number;
    _probeConnectState: IPProbeState;
    private _mainSvrInfo;
    private _byPassSvrInfo;
    constructor(_stateCenter: StateCenter, _logger: ZegoLogger, proxyCtrl?: any);
    createSockets(mainSvrInfo: ConnectServerInfo, byPassSvrInfo?: ConnectServerInfo): void;
    bindServiceHandler(service: NetSocketService, connectSvrInfo: ConnectServerInfo): void;
    checkProbeState(): void;
    removeServiceListener(service: NetSocketService): void;
    destroySockets(): void;
    /**
     * 优先连接成功的 service
     * @param service
     * @param connectSvrInfo
     */
    onSocketOpen(service: NetSocketService, connectSvrInfo: ConnectServerInfo): void;
    /**
     * 次连接成功的 service
     * @param service
     * @param connectSvrInfo
     */
    onNextSocketOpen(service: NetSocketService, connectSvrInfo: ConnectServerInfo): void;
    /**
     * h3 连接失败，回退 wss
     * @param connectSvrInfo
     */
    onSocketBackToWebSocket(connectSvrInfo: ConnectServerInfo, reason: WebTransportError, error: any): void;
    /**
     * 连接均失败，需发起重试
     */
    onSocketsFail(): void;
    onIPStackDetection(stackDetection: StackDetection): void;
}

import { ZegoLogger } from '../../util/logger';
import { PcConnectState, BusinessService, DisconnectedType, PCOption, ERROR } from '../../entity/AccessHubDefine';
import { NetAgentPCRequest } from './NetAgentPCRequest';
import { StreamManager } from '../stream/StreamManager';
import { StateCenter } from '../stateCenter';
export declare class NetAgentPCRequestMgr {
    private _streamManager;
    private _stateCenter;
    pcStreamRequests: NetAgentPCRequest[];
    pcEstablishTimeout: number;
    get _logger(): ZegoLogger;
    constructor(_streamManager: StreamManager, _stateCenter: StateCenter);
    getRequest(service: BusinessService, option?: PCOption): NetAgentPCRequest;
    updateConnectState(state: PcConnectState, type: DisconnectedType, error?: ERROR): void;
    closePCs(errorCode: number, disConnectType?: DisconnectedType): void;
    setEstablishTimeout(timeout: number): void;
}

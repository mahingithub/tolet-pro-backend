import { AppInfo, ENUM_NETWORK_STATE, IPStackDetection, IPStackType, ISettingConfig, IPList, RetryLevel } from '../entity/AccessHubDefine';
import { ZegoLogger } from '../util/logger';
export declare class StateCenter {
    networkState: ENUM_NETWORK_STATE;
    userId: string;
    appInfo: AppInfo;
    useNetAgent: boolean;
    specified: boolean;
    clientIP: string;
    byPassClientIP: string;
    timeOffset: number;
    networkRTT: number;
    ntpTimeInfo?: {
        performanceTime: number;
        ntp: number;
    };
    enableHttp3: boolean;
    isDestroyed: boolean;
    lastRecvMsgTime: number;
    customConfig: ISettingConfig;
    linkIpStackDetection: IPStackDetection;
    isIpStackDetected: boolean;
    currentIpStackType: IPStackType;
    ipList: IPList;
    logger: ZegoLogger;
    retryLevel: RetryLevel;
    constructor();
    get appID(): number;
    get env(): number;
    updateNTP(org: number, xmt: number, now: number): void;
}

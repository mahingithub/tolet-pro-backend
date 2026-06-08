import { ZegoLogger, ZegoRoomInfo, ZReporter, ZegoDataReport, ZegoScenario, ZegoNetmode, AutoSwitchDeviceConfig, SEIConfig, ENUM_NETWORK_STATE, EngineConfig, ZegoReportSpan } from './zego.entity';
import { actionSuccessCallback, checkValidNumber, decodeServerError, getLiveRoomError, getServerError, logReportCallback, mergeStreamList, uint8arrayToBase64, unregisterCallback } from '../util/client-util';
import { ZegoSettingConfig } from './setting.config';
import { ZegoExpressWebRTM } from '../rtm';
import { IPStackMode } from './zego.entity';
export declare class StateCenter {
    private _zgp_logger;
    private _zgp_dataReport?;
    debug: boolean;
    testEnvironment: boolean;
    pullLimited: boolean;
    useNetAgent: boolean;
    configOK: boolean;
    appid: number;
    bizVersion: string;
    relateService: Array<string>;
    role: 1 | 2;
    server: string;
    serverBak: string;
    idName: string;
    nickName: string;
    userStateUpdate: boolean;
    maxMemberCount: number;
    roomCreateFlag: number;
    netMode: ZegoNetmode;
    callbackList: {
        [index: string]: Function;
    };
    experimentalAPIList: any;
    publishStreamList: {
        [key: string]: {
            roomID: string;
            state: any;
            extra_info: string | undefined;
        };
    };
    backgroundBlurManager: any;
    streamUrlMap: any;
    cmdCallback: any;
    customUrl: any;
    customPlayUrl: any;
    screenShotStream: MediaStream;
    turnOnly: boolean;
    _zgp_turnOverTcpOnly: boolean | undefined;
    extTurnNode: string;
    audioEffectBuffer: any;
    audioBitRate: number;
    cdnSeq: number;
    cdnSeqV2: number;
    rtm?: ZegoExpressWebRTM;
    engineDestroy: boolean;
    listenerList: {
        [index: string]: Array<Function>;
    };
    reportList: {
        [index: string]: Function;
    };
    reportSeqList: {
        startPublish: {
            [index: string]: number;
        };
        rePublish: {
            [index: string]: number;
        };
        startPlay: {
            [index: string]: number;
        };
        rePlay: {
            [index: string]: number;
        };
        stopPublish: {
            [index: string]: number;
        };
        stopPlay: {
            [index: string]: number;
        };
    };
    clientType: string | undefined;
    streamTrigger: any;
    audioStreamList: {
        [index: string]: {
            mic: MediaStreamAudioSourceNode;
            script: ScriptProcessorNode;
        };
    };
    deviceInfos: any;
    deviceChangeTimer: any;
    deviceStateOut: boolean;
    clientTimeOffset: number;
    _zgp_netAppConfig: any;
    supportBg: any;
    browserInfo: {
        name: string;
        version: string;
    };
    customUa: boolean;
    get networkState(): ENUM_NETWORK_STATE | undefined;
    set networkState(val: ENUM_NETWORK_STATE | undefined);
    get isFlutter(): boolean;
    streamRetryTime: number;
    serverRetryTime: number;
    checkList: string[];
    anchor_info: {
        anchor_id: string;
        anchor_id_name: string;
        anchor_nick_name: string;
    };
    clientIP: string;
    accessClientIp: string;
    isMultiOuter: boolean;
    roomList: Array<ZegoRoomInfo>;
    _zgp_isMultiRoom: boolean;
    browser: string;
    unregisterSeiFilter: string;
    reporter: ZReporter;
    getReportSeq: Function;
    getSeq: Function;
    isTestMode: boolean;
    debugLog: boolean;
    netAppConfigDelay: number;
    logReportCallback: typeof logReportCallback;
    unregisterCallback: typeof unregisterCallback;
    decodeServerError: typeof decodeServerError;
    getLiveRoomError: typeof getLiveRoomError;
    getServerError: typeof getServerError;
    mergeStreamList: typeof mergeStreamList;
    actionSuccessCallback: typeof actionSuccessCallback;
    checkValidNumber: typeof checkValidNumber;
    uint8arrayToBase64: typeof uint8arrayToBase64;
    settingConfig: ZegoSettingConfig;
    _zgp_seiConfig: SEIConfig;
    appConfig: any;
    playAccelerate: boolean;
    sdkVerNum: number;
    autoSwitchDeviceSetting: AutoSwitchDeviceConfig;
    unSendMessageList: {
        roomID: string;
        streamid: string;
        cmd: number;
        stream_extra_info: string;
    }[];
    scenario: ZegoScenario;
    testStreamRetryMode: number;
    testStreamRetryCount: number;
    supportDispatchByPass: boolean;
    testStreamStatusSeq: number;
    engineConfig: EngineConfig;
    _zgp_isMiniSdp: boolean;
    _zgp_forceMiniSdp: boolean;
    get selectIPStackMode(): IPStackMode;
    player265Validated: boolean;
    player265ReceiverList: {
        sendMsg: Function;
    }[];
    get isMiniSdp(): boolean;
    setIsMiniSdp(bool: boolean): void;
    constructor(_zgp_logger: ZegoLogger, _zgp_dataReport?: ZegoDataReport | undefined);
    private _zgp_streamCenter;
    set streamCenter(streamCenter: any);
    get streamCenter(): any;
    getRequestId(): string;
    addListener(listener: string, callBack: Function): boolean;
    actionListener(listener: string, ...args: Array<any>): void;
    deleteListener(listener: string, callBack?: Function): boolean;
    getRoomByRoomID(roomID: string): ZegoRoomInfo | undefined;
    getPlayRoom(streamID: string): ZegoRoomInfo | undefined;
    onExperimentalAPICallback(content: Record<string, any>): void;
    _zgp_getCloudSetting(key: string, force?: boolean): any;
    destroy(): void;
    miniSdpError: number;
    debugConfig: any;
    debugVerboseUpdateList: {
        [index: string]: Array<Function>;
    };
    onDebugVerboseCallBack(listener: string, ...args: Array<any>): void;
    _zgp_updateSpanByLevel(span: ZegoReportSpan, attributes: {
        [key: string]: any;
    }): void;
    setEnableExtTurn(bool: boolean): void;
    get IsEnableExtTurn(): boolean;
    setExtTurnNode(node: string): void;
}

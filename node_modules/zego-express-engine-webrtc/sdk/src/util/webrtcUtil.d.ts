import { CapabilityDetection, CapabilityDetectionSingle, Constraints, SupportVideoCodeSucCall, ZegoCheckSingleType, ConstraintExtend, IpResult, ZegoRemoteDeviceState, CameraConstraints, ScreenConstrains, StateInfo } from '../common/zego.entity.web';
import { ERRO, StreamMode } from '../common/zego.entity';
export declare function isHttpsOrLocalhost(): boolean;
export declare function supportVideoCodeType(sucCall: SupportVideoCodeSucCall, checkLevel: 0 | 1, type?: 'webRTC' | 'VP8' | 'H264' | 'H265' | 'newWay', customUa?: boolean): Promise<void>;
export declare function supportDetection(screenShotReady: boolean, success: (result: CapabilityDetection | CapabilityDetectionSingle) => void, checkLevel: 0 | 1, type?: ZegoCheckSingleType, customUa?: boolean): Promise<void>;
export declare const WebRTCUtil: {
    supportDetection: typeof supportDetection;
};
export declare const deleteKeyWithQuality: (options: CameraConstraints | ScreenConstrains) => CameraConstraints | ScreenConstrains;
export declare function deleteUndefinedKey(options: any): any;
export declare function base64ToUint8Array(base64String: string): Uint8Array;
export declare function decodeString(u8arr: Uint8Array): string;
export declare function encodeString(str: string): Uint8Array;
export declare const splitSections: (blob: string) => string[];
export declare function getCandidate(sdp: string): any;
export declare function getIceUfrag(sdp: string): string;
export declare function getIcePwd(sdp: string): string;
export declare function getIPByNode(node: string): string;
export declare function getStreamSourceType(mode: number): StreamMode;
export declare function getChromeVer(): number;
export declare function getVersionNumber(version: string): number;
export declare function isAdaptBrowserVersion(browserInfo: {
    name: string;
    version: string;
}, bro: string, ver: number, compare: number): boolean;
export declare function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream | any>;
/**
 * 上一次调度节点{A、B、C、D} 已试节点A、B
 * 1、重新调度节点{A、B、C、D},  对比已试节点列表， 重新排序{C、D、A、B}，C节点首先被重试 => sortGwNodes(['A','B', 'C', 'D'], ['A', 'B'])
 * 2、重新调度节点{E、F、A、G},  对比已试节点列表， 重新排序{E、F、G、A}，E节点首先被重试 => sortGwNodes(['E','F', 'A', 'G'], ['A', 'B'])
 * 3、重新调度节点{A、B、E、F},  对比已试节点列表， 重新排序{E、F、A、B}，E节点首先被重试 => sortGwNodes(['A','B', 'E', 'F'], ['A', 'B'])
 */
export declare function sortGwNodes(newNodes: string[], oldNodes: string[], isDispatchByPass: boolean): string[];
export declare function sortIPNodes(newNodes: IpResult[], oldNodes: IpResult[], isDispatchByPass: boolean): IpResult[];
export declare function createGwNode(ipNode: IpResult): string;
export declare function getIPNodeIndex(ipNodeList: IpResult[], gwNode: string): number;
export declare function formatTypePreference(pref: number, browser: string): string | undefined;
export declare function getElemByMediaStream(stream: MediaStream | null, tagName?: string): HTMLMediaElement | null;
export declare function getDevices(deviceInfoCallback: (res: {
    microphones: Array<{
        deviceName: string;
        deviceID: string;
    }>;
    speakers: Array<{
        deviceName: string;
        deviceID: string;
    }>;
    cameras: Array<{
        deviceName: string;
        deviceID: string;
    }>;
}) => void, error: (err: ERRO) => void): void;
export declare function checkBitRateLimit(bitRateValue: number, errorCallback: Function): boolean;
export declare function checkCameraOrScreenBitRate(bitRate: number | undefined, errorCallback: Function): boolean;
export declare function checkConstraintExtendWithMessage(constraintExtend: ConstraintExtend, param: string, limitMin?: number, // 每个参数限制的最小值
limitMax?: number): {
    result: boolean;
    message: string;
};
export declare function checkConstraintExtend(constraintExtend: ConstraintExtend, param: string, errorCallback?: Function, // for createStream
limitMin?: number, // 每个参数限制的最小值（正整数）
limitMax?: number): boolean;
export declare function checkParamsWithConstraintExtend(paramsToBeCheck: string[], constraints: {
    width?: number | ConstraintExtend;
    height?: number | ConstraintExtend;
    frameRate?: number | ConstraintExtend;
}, errorCallback?: Function): boolean;
export declare function checkScreenParams(screen: Constraints['screen'], callByUser: boolean, // 内部校验调用不检查videoQuality 为 4 的相关参数必传
errorCallback: Function): boolean;
export declare function checkCameraParams(cameras: {
    width?: number | ConstraintExtend;
    height?: number | ConstraintExtend;
    frameRate?: number | ConstraintExtend;
    bitRate?: number;
}, errorCallback: Function): boolean;
export declare function getTrackStatusCode(track: MediaStreamTrack): ZegoRemoteDeviceState;
export declare function getPreviewParamMinVal(val: number | ConstraintExtend): number;
export declare function isValidIPv4(ipv4: string): boolean;
export declare function ipv4ToDNS64(ipv4: string): string;
export declare const simplyIPRes: (msg: {
    ips: IpResult[];
    ipv6s: IpResult[];
}) => void;
export declare const isStreamCBStateChanged: (newCBState: StateInfo, curCBState: StateInfo) => boolean;
export declare const getCodecId: (codec: string) => number;

import { AccessHubMessageType, StreamType } from '../../entity/AccessHubDefine';
import { ZegoLogger } from '../../util/logger';
import { ZegoWssLink } from '../net/ZegoWssLink';
import { StateCenter } from '../stateCenter';
import { ZegoLinkStream } from './ZegoLinkStream';
export declare class StreamManager {
    private _zegoLink;
    private _stateCenter;
    streamID: number;
    pcStreams: ZegoLinkStream[];
    streams: ZegoLinkStream[];
    hbStream: ZegoLinkStream | undefined;
    get _logger(): ZegoLogger;
    constructor(_zegoLink: ZegoWssLink, _stateCenter: StateCenter);
    destroy(): void;
    createStream(streamType: StreamType): ZegoLinkStream;
    getHbStream(): ZegoLinkStream;
    getFreeStream(streamType: StreamType): ZegoLinkStream;
    onPushEvent(streamID: number, msgType: AccessHubMessageType, msg: any, extras?: any): void;
    getNextStreamID(): number;
    refreshAllStream(): void;
    clearStreams(): void;
}

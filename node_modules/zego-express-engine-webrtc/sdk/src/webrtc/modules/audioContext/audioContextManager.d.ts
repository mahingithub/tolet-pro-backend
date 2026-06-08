import type { ZegoLogger } from '../../../common/zego.entity';
import { MediaElementRenderer } from './mediaElementRenderer';
export declare class AudioContextManager {
    private _zgp_logger;
    static mgr: AudioContextManager;
    ac: AudioContext;
    private isResuming;
    id: number;
    _zgp_elementNodeMap: Map<HTMLMediaElement, MediaElementRenderer>;
    _zgp_workletMap: Map<string, boolean>;
    private lastAcState;
    private _zgp_eventManager;
    constructor(_zgp_logger: ZegoLogger);
    static create(_zgp_logger: ZegoLogger): AudioContextManager;
    getMediaElementRenderer(audio: HTMLMediaElement): MediaElementRenderer | null;
    private eventHandler;
    private checkAudioContext;
    private offCheckAudioContextListener;
    registerModule(moduleKey: string, fileContent: string): Promise<void>;
    destroy(): void;
    on<k extends keyof AudioContextManagerEvent>(event: k, callBack: AudioContextManagerEvent[k]): boolean;
    off<k extends keyof AudioContextManagerEvent>(event: k, callBack?: AudioContextManagerEvent[k]): boolean;
}
interface AudioContextManagerEvent {
    audioRecover: (e: any) => void;
}
export {};

import { ZegoStreamCenterWeb } from '../zego.streamCenter.web';
import { ZegoLogger } from '../../../common/zego.entity';
import { ZegoLogStrategy } from 'zego-express-logger/sdk/src/zego.entity';
import { StateCenter } from '../../../common/stateCenter';
import { QualityGrade } from '../../../common/zego.entity.web';
export declare class BandwidthAssessment {
    private _zgp_logger;
    private _zgp_streamCenter;
    private _zgp_stateCenter;
    constructor(_zgp_logger: ZegoLogger, _zgp_streamCenter: ZegoStreamCenterWeb, _zgp_stateCenter: StateCenter);
    private get _zgp_speedLogSpeed();
    private _zgp_getTracerSpeed;
    timer: number;
    static defaultAvailableBitrate: number;
    _zgp_currentGrade: QualityGrade;
    _zgp_currentStrategy: ZegoLogStrategy;
    setUploadStrategy(strategy: ZegoLogStrategy, log?: string): boolean;
    start(): void;
    endStreamTime?: number;
    private _zgp_checkNetQualityGrade;
    lazyStopCheck(): void;
    stop(): void;
    _zgp_transGradeToStrategy(grade: QualityGrade): ZegoLogStrategy;
}

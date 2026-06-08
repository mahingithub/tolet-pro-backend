export declare class SpeedUtil {
    private _zgp_name;
    count: number;
    constructor(_zgp_name?: string);
    isStarting: boolean;
    timer: number;
    add(length: number): void;
    stop(): void;
    lastLogTime: number;
    speed: number;
    lastTime: number;
    start(interval?: number): void;
    reset(): void;
}

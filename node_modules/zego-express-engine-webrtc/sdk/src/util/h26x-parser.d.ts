export declare class H26xParser {
    private view;
    private isH265;
    offset: number;
    current_start_code_size: number;
    current_nalu_start: number;
    current_nalu_size: number;
    start_code_size: number;
    nalu_start: number;
    left_size: number;
    nalu_size: number;
    constructor(view: DataView, isH265?: boolean);
    FindStartCode(): boolean;
    FindNalu(): boolean;
    NextNalu(isSei?: boolean): boolean;
}

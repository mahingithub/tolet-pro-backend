import { ZegoError } from '../rtm/zego.entity';
import { ZegoLogger } from '../common/zego.entity';
export declare enum RULE_PARAM_NAME {
    NOT_EMPTY = "NOT_EMPTY",
    ILLEGAL_CHARACTERS = "ILLEGAL_CHARACTERS",
    TYPE_STRING = "TYPE_STRING",
    TYPE_INTEGER = "TYPE_INTEGER",
    TYPE_OBJECT = "TYPE_OBJECT",
    MAX_LENGTH_10 = "MAX_LENGTH_10",
    MAX_LENGTH_64 = "MAX_LENGTH_64",
    MAX_LENGTH_100 = "MAX_LENGTH_100",
    MAX_LENGTH_128 = "MAX_LENGTH_128",
    MAX_LENGTH_256 = "MAX_LENGTH_256",
    MAX_LENGTH_1024 = "MAX_LENGTH_1024"
}
interface RuleTemplate {
    name?: RULE_PARAM_NAME;
    error: ZegoError;
    extMsg?: string;
}
export declare const RULE_SUCCESS: RuleTemplate;
interface ParamTemplate {
    key?: string;
    order: number;
    value: any;
    rules: RuleTemplate[];
}
export declare function checkParams(sourceMap: {
    [index: string]: ParamTemplate;
}, option: {
    logger: ZegoLogger;
    action: string;
}): RuleTemplate;
export declare function checkNumberRange(object: any, key: string, val: number, max: number, min: number): void;
export declare function checkNotUndefinedAndInteger(val: number | undefined, positive?: boolean): boolean;
export declare function checkNotUndefinedAndString(val: string | undefined): boolean;
export declare function checkNotNullAndString(val: string | undefined): boolean;
export declare function checkNotUndefinedAndBoolean(val: boolean | undefined): boolean;
export declare function checkNotContainValue(val: any, enumList: any[]): boolean;
export {};

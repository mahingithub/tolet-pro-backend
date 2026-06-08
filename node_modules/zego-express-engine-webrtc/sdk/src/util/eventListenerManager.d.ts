/**
 * 事件监听器管理器
 * 用于统一管理对象的事件监听器，方便统一移除
 */
export declare class EventListenerManager {
    private listenerMap;
    bind(target: object, eventTarget: EventTarget | any): {
        add: (eventName: string, handler: (...args: any[]) => void) => any;
    };
    cleanup(target: object): void;
}

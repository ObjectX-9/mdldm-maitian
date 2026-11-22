export function ensure(): Promise<void>;
export function evaluate(tabId: number, expression: string, timeout?: number): Promise<unknown>;
export function sleep(ms: number): Promise<void>;
export function withTab<T>(url: string, fn: (tabId: number) => Promise<T>, options?: { wait?: number }): Promise<T>;

export function click(tabId: number, expression: string): Promise<unknown>;
export function screenshot(tabId: number, clip?: { x: number; y: number; width: number; height: number; scale: number }): Promise<Buffer>;
export function close(): Promise<void>;
export const mode: string;
export function openTab(url: string): Promise<number>;
export function closeTab(tabId: number): Promise<void>;
export function openedTab(openerId: number, origin: string): Promise<number | null>;

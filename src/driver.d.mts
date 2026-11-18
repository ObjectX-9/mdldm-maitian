export function ensure(): Promise<void>;
export function evaluate(tabId: number, expression: string, timeout?: number): Promise<unknown>;
export function sleep(ms: number): Promise<void>;
export function withTab<T>(url: string, fn: (tabId: number) => Promise<T>, options?: { wait?: number }): Promise<T>;

export function click(tabId: number, expression: string): Promise<unknown>;
export function screenshot(tabId: number): Promise<Buffer>;
export function close(): Promise<void>;

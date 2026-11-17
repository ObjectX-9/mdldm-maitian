import type { IncomingMessage } from 'node:http';
import type { WebConfig } from './server-types.ts';
export function accessEmail(req: IncomingMessage, access?: WebConfig['access']): Promise<string | null>;

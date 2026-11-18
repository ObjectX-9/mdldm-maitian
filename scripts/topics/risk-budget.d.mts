export function reserveDetail(directory:string,platform:string,isDetail?:boolean):Promise<{allowed:boolean;reason?:string;requiresUser?:boolean;retryAfterMs?:number;count?:number;platformCount?:number}>;
export function blockPlatform(directory:string,platform:string,reason:string):Promise<void>;

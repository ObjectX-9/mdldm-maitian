export interface ServiceConfig {
  name: string
  port: number
  url?: string
  healthPath?: string
}

export type ProbeFailure = 'timeout' | 'dns' | 'tls' | 'refused' | 'connection' | 'http' | 'not-listening' | 'ssh' | 'unavailable'

export interface ServiceCheck {
  name: string
  port: number
  url?: string
  status: 'up' | 'down' | 'http-error' | 'unknown'
  httpStatus?: number
  latencyMs: number | null
  probeKind?: 'http' | 'tcp'
  domainLatencyMs?: number
  domainFailure?: ProbeFailure
  originFailure?: ProbeFailure
}

export interface ServiceMonitorData {
  checkedAt: string
  remote: boolean
  services: ServiceCheck[]
  configWarning?: string
  probeError?: string
}

export interface ServiceTrafficSite {
  host: string
  name: string
  source: 'caddy' | 'api' | 'unconfigured'
}

export type ServiceTrafficRange = 'auto' | '1h' | '24h' | '7d' | 'all'

export interface ServiceTrafficData {
  range: ServiceTrafficRange
  bucketMs: number
  start: number
  end: number
  sites: ServiceTrafficSite[]
  points: { site: string; bucket: number; requests: number; errors: number; p95Ms: number }[]
}

import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ProbeFailure, ServiceCheck, ServiceConfig, ServiceMonitorData } from '../shared/services.ts';

const host = '127.0.0.1';
const timeout = 5000;
const run = promisify(execFile);
const sshTarget = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/);
const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  port: z.number().int().min(1).max(65535),
  url: z.string().max(512).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }).transform(value => new URL(value).href).optional(),
  healthPath: z.string().max(512).regex(/^\/(?!\/)[^\s\\#]*$/).optional(),
});

function probeFailure(error: NodeJS.ErrnoException): ProbeFailure {
  const code = error.code ?? '';
  if (code === 'ABORT_ERR' || code === 'ETIMEDOUT') return 'timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code.startsWith('HPE_')) return 'http';
  if (/TLS|SSL|CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code)) return 'tls';
  return 'connection';
}

function checkPort(port: number): Promise<ProbeFailure | undefined> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    const finish = (failure?: ProbeFailure) => { socket.destroy(); resolve(failure); };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish('timeout'));
    socket.once('error', error => finish(probeFailure(error)));
  });
}

function checkHttp(url: URL): Promise<{ status: number } | { failure: ProbeFailure }> {
  return new Promise(resolve => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const probe = request(url, { agent: false, signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Maitian-Service-Probe' } }, response => {
      response.destroy();
      resolve(response.statusCode === undefined ? { failure: 'http' } : { status: response.statusCode });
    });
    probe.once('error', error => resolve({ failure: probeFailure(error) }));
    probe.end();
  });
}

async function checkService({ name, port, url, healthPath }: ServiceConfig): Promise<ServiceCheck> {
  const start = performance.now();
  const target = { name, port, url };
  if (healthPath) {
    const result = await checkHttp(new URL(healthPath, `http://${host}:${port}`));
    const httpStatus = 'status' in result ? result.status : undefined;
    const status = httpStatus === undefined ? 'down' : httpStatus >= 200 && httpStatus < 400 ? 'up' : 'http-error';
    return { ...target, status, httpStatus, probeKind: 'http', latencyMs: httpStatus === undefined ? null : Math.round(performance.now() - start),
      originFailure: 'failure' in result ? result.failure : undefined };
  }
  const originFailure = await checkPort(port);
  return { ...target, status: originFailure ? 'down' : 'up', probeKind: 'tcp', originFailure, latencyMs: originFailure ? null : Math.round(performance.now() - start) };
}

const remoteProbeSchema = z.array(z.object({
  listening: z.boolean(), latencyMs: z.number().nonnegative().nullable(), httpStatus: z.number().int().optional(),
  failure: z.enum(['timeout', 'refused', 'connection', 'http', 'not-listening']).optional(),
}));

async function remoteProbes(target: string, services: ServiceConfig[]) {
  const entries = services.map(({ port, url, healthPath }) => {
    const origin = healthPath || url ? new URL(healthPath ?? '/', `http://${host}:${port}`) : undefined;
    return { port, path: origin && origin.pathname + origin.search };
  });
  const payload = Buffer.from(JSON.stringify(entries), 'utf8').toString('base64');
  const command = String.raw`python3 - <<'MAITIAN_PROBE'
import base64
import concurrent.futures
import http.client
import json
import re
import socket
import subprocess
import time

targets = json.loads(base64.b64decode('${payload}'))
result = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'], capture_output=True, text=True, timeout=3)
if result.returncode and (result.returncode != 1 or result.stderr):
    result.check_returncode()
ports = {int(port) for port in re.findall(r'^n\S+:(\d+)$', result.stdout, re.M)}
timeout = ${timeout} / 1000

def probe(target):
    port = target['port']
    measurement = {'listening': port in ports, 'latencyMs': None}
    if not measurement['listening']:
        measurement['failure'] = 'not-listening'
        return measurement
    started = time.monotonic()
    try:
        if 'path' in target:
            client = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
            try:
                client.request('GET', target['path'], headers={'User-Agent': 'Maitian-Service-Probe'})
                client.sock.settimeout(max(0.001, timeout - (time.monotonic() - started)))
                with client.getresponse() as response:
                    measurement['httpStatus'] = response.status
            finally:
                client.close()
        else:
            with socket.create_connection(('127.0.0.1', port), timeout=timeout):
                pass
        measurement['latencyMs'] = round((time.monotonic() - started) * 1000)
    except TimeoutError:
        measurement['failure'] = 'timeout'
    except ConnectionRefusedError:
        measurement['failure'] = 'refused'
    except http.client.RemoteDisconnected:
        measurement['failure'] = 'connection'
    except http.client.HTTPException:
        measurement['failure'] = 'http'
    except OSError:
        measurement['failure'] = 'connection'
    return measurement

with concurrent.futures.ThreadPoolExecutor(max_workers=len(targets)) as pool:
    print(json.dumps(list(pool.map(probe, targets))))
MAITIAN_PROBE`;
  const { stdout } = await run('ssh', [
    '-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=yes',
    '--', target, command,
  ], { timeout: 14000, maxBuffer: 128 * 1024 });
  return remoteProbeSchema.length(entries.length).parse(JSON.parse(stdout));
}

export function createServiceMonitor(input: unknown, webPort: number, hostname?: string, configuredTarget?: string) {
  const configured = z.array(z.unknown()).max(50).safeParse(input === undefined ? [] : input);
  const services: ServiceConfig[] = [];
  const invalid: number[] = [];
  if (configured.success) configured.data.forEach((entry, index) => {
    const result = serviceSchema.safeParse(entry);
    if (result.success) services.push(result.data);
    else invalid.push(index + 1);
  });
  const remote = configuredTarget !== undefined;
  const target = sshTarget.safeParse(configuredTarget);
  const configWarning = remote && !target.success ? 'config.json 的 serviceMonitorSshHost 必须是 SSH 主机别名。'
    : !configured.success ? 'config.json 的 services 必须是最多 50 项的数组。'
      : invalid.length ? `config.json 的 services 中，第 ${invalid.join('、')} 项格式无效。` : undefined;
  if (!remote && !services.some(service => service.port === webPort)) {
    const url = serviceSchema.shape.url.safeParse(hostname ? `https://${hostname}` : undefined);
    services.unshift({ name: '麦田工作台', port: webPort, url: url.success ? url.data : undefined });
  }

  let latest: ServiceMonitorData | undefined;
  let pending: Promise<ServiceMonitorData> | undefined;
  const collectLocal = async () => {
    if (!remote) return { results: await Promise.all(services.map(checkService)), probeError: undefined };
    let samples: Awaited<ReturnType<typeof remoteProbes>> | undefined;
    let probeError: string | undefined;
    if (target.success && services.length) {
      try { samples = await remoteProbes(target.data, services); }
      catch { probeError = '无法通过 SSH 读取目标主机的监听状态。'; }
    }
    const results = services.map(({ name, port, url, healthPath }, index): ServiceCheck => {
      const sample = samples?.[index];
      return {
        name, port, url, latencyMs: sample?.latencyMs ?? null, httpStatus: sample?.httpStatus,
        probeKind: healthPath || url ? 'http' : 'tcp',
        originFailure: sample ? sample.failure : target.success ? 'ssh' : 'unavailable',
        status: !sample ? 'unknown' : sample.listening ? 'up' : 'down',
      };
    });
    return { results, probeError };
  };
  const collect = async (): Promise<ServiceMonitorData> => {
    const [{ results, probeError }, domainProbes] = await Promise.all([
      collectLocal(),
      Promise.all(services.map(async ({ url }) => {
        if (!url) return undefined;
        const start = performance.now();
        const result = await checkHttp(new URL(url));
        return 'failure' in result
          ? { domainFailure: result.failure }
          : { domainLatencyMs: Math.round(performance.now() - start) };
      })),
    ]);
    const checks = results.map((result, index) => ({ ...result, ...domainProbes[index] }));
    return { services: checks, remote, checkedAt: new Date().toISOString(), configWarning, probeError };
  };
  return () => {
    if (pending) return pending;
    if (latest && Date.now() - Date.parse(latest.checkedAt) < 5000) return Promise.resolve(latest);
    pending = collect().then(result => { latest = result; return result; }).finally(() => { pending = undefined; });
    return pending;
  };
}

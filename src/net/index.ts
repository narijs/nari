import dns, { LookupAddress } from 'dns';
import http from 'http';
import https from 'https';
import { OutgoingHttpHeaders } from 'http2';
import { TOOL_NAME, VERSION } from '../constants';

let ipv6 = true;

export const disableIpv6 = () => (ipv6 = false);

const agent = new https.Agent({
  lookup: (hostname, opts, cb) => {
    dns.lookup(hostname, opts, (err, address, family) => {
      let resolvedAddress: string | LookupAddress[] = address;
      if (Array.isArray(address) && !ipv6) {
        resolvedAddress = address.filter((a) => a.family !== 6);
      }
      cb(err, resolvedAddress as unknown as string, family);
    });
  },
  keepAlive: true,
  maxSockets: 64,
});

https.globalAgent = agent;

export type GetOptions = {
  headers?: OutgoingHttpHeaders;
};

const request = async (
  url: string,
  options: http.RequestOptions,
): Promise<{ response: http.IncomingMessage; error?: undefined } | { response?: undefined; error: any }> => {
  return new Promise((resolve) => {
    https.get(url, options, (response) => resolve({ response })).on('error', (error) => resolve({ error }));
  });
};

const MAX_RETRIES = 5;
const RETRY_TIMEOUT = 1000;

export const get = async (url: string, opts?: GetOptions): Promise<http.IncomingMessage> => {
  const headers = opts?.headers || {};

  headers['User-Agent'] = `${TOOL_NAME}/${VERSION} npm/? node/${process.version} ${process.platform} ${process.arch}`;

  let retries = 0;
  let lastError;

  do {
    const { response, error } = await request(url, { headers });
    if (response) {
      return response;
    } else {
      lastError = error;
    }

    if (error.code && error.code === 'ENETUNREACH') {
      disableIpv6();
    }

    retries++;
    if (retries > 1) {
      await new Promise((r) => setTimeout(r, RETRY_TIMEOUT));
    }
  } while (retries < MAX_RETRIES);

  throw lastError;
};

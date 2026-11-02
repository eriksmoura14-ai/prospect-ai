"""Bounded public Places column reads without caching another whole raw file.

DuckDB talks only to loopback. Requests retains the inherited HTTPS proxy and
TLS trust. Source identity is the pinned URL, size, and consistent strong ETag;
range digests are recorded explicitly, never called a full-file SHA-256.
"""
import collections
import hashlib
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import requests

MAX_CACHE = 16 * 1024 * 1024


def validate_range(start, end, size):
    if not (type(start) is int and type(end) is int and 0 <= start <= end < size and end - start + 1 <= 32 * 1024 * 1024):
        raise RuntimeError('places_range_budget')


class PlaceRanges:
    def __init__(self, part, seconds=600, read_ahead_bytes=0):
        self.part = part
        parsed = urlsplit(part['url'])
        if (parsed.scheme != 'https' or parsed.netloc != 'overturemaps-us-west-2.s3.us-west-2.amazonaws.com'
                or not re.fullmatch(r'/release/2026-10-21\.0/theme=places/type=place/part-[0-9]{5}-[a-f0-9-]+-c000\.zstd\.parquet', parsed.path)
                or parsed.query or parsed.fragment or type(part['bytes']) is not int or not 0 < part['bytes'] < 900 * 1024 * 1024):
            raise ValueError('unreviewed_places_partition')
        self.size = part['bytes']
        if type(read_ahead_bytes) is not int or not 0 <= read_ahead_bytes <= 4 * 1024 * 1024:
            raise ValueError('places_read_ahead_budget')
        self.read_ahead_bytes = read_ahead_bytes
        self.maximum = self.size + 32 * 1024 * 1024
        self.deadline = time.monotonic() + seconds
        self.received = self.requested = self.reused = self.cache_bytes = 0
        self.etag = None
        self.retry_after_unix = 0
        self.last_http_status = None
        self.ranges = []
        self.errors = []
        self.cache = collections.OrderedDict()
        self.lock = threading.Lock()
        self.server = None
        self.session = requests.Session()

    def read(self, start, end):
        validate_range(start, end, self.size)
        with self.lock:
            if time.monotonic() > self.deadline:
                raise RuntimeError('places_range_deadline')
            requested_start, requested_end = start, end
            for (first, last), cached in list(self.cache.items()):
                if first <= start <= end <= last:
                    self.cache.move_to_end((first, last))
                    self.reused += end - start + 1
                    return cached[start-first:end-first+1]
            if self.read_ahead_bytes:
                start = start // self.read_ahead_bytes * self.read_ahead_bytes
                end = min(self.size - 1, max(end, start + self.read_ahead_bytes - 1))
                if end - start + 1 > 32 * 1024 * 1024:
                    start, end = requested_start, requested_end
            key = (start, end)
            if self.requested + end - start + 1 > self.maximum:
                raise RuntimeError('places_source_transfer_budget')
            self.requested += end - start + 1
            headers = {'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity',
                       'User-Agent': 'ProspectAI-finite-global-inventory-sweep/1.0'}
            if self.etag:
                headers['If-Match'] = self.etag
            with self.session.get(self.part['url'], headers=headers, stream=True, timeout=(10, 35), allow_redirects=False) as response:
                self.last_http_status = response.status_code
                if response.status_code in (429, 503):
                    retry = response.headers.get('Retry-After', '')
                    self.retry_after_unix = int(time.time()) + max(60, int(retry) if str(retry).isdigit() else 60)
                    raise RuntimeError('places_source_shared_cooldown')
                if response.status_code != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{self.size}':
                    raise RuntimeError('places_source_invalid_range_response')
                etag = response.headers.get('ETag', '')
                if not etag or etag.startswith('W/') or self.etag and etag != self.etag:
                    raise RuntimeError('places_source_identity_changed')
                self.etag = etag
                chunks = []
                size = 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    self.received += len(chunk)
                    if size > end - start + 1 or time.monotonic() > self.deadline:
                        raise RuntimeError('places_range_response_budget')
                    chunks.append(chunk)
                if size != end - start + 1:
                    raise RuntimeError('places_range_truncated')
            body = b''.join(chunks)
            self.ranges.append({'start': start, 'end': end, 'sha256': hashlib.sha256(body).hexdigest()})
            if len(body) <= MAX_CACHE:
                while self.cache and self.cache_bytes + len(body) > MAX_CACHE:
                    _, value = self.cache.popitem(last=False)
                    self.cache_bytes -= len(value)
                self.cache[key] = body
                self.cache_bytes += len(body)
            return body[requested_start-start:requested_end-start+1]

    def start(self):
        source = self

        class Gateway(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_HEAD(self):
                self.send_response(200)
                self.send_header('Content-Length', source.size)
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()

            def do_GET(self):
                try:
                    match = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
                    if not match or not any(match.groups()):
                        raise RuntimeError('places_range_required')
                    first, last = match.groups()
                    start = int(first) if first else source.size - int(last)
                    end = int(last) if first and last else source.size - 1
                    body = source.read(start, end)
                    self.send_response(206)
                    self.send_header('Content-Length', len(body))
                    self.send_header('Content-Range', f'bytes {start}-{end}/{source.size}')
                    self.end_headers()
                    self.wfile.write(body)
                except Exception as error:
                    source.errors.append(str(error) if isinstance(error, RuntimeError) else 'places_network_error')
                    self.send_error(503, 'Stopped by source or resource budget')

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Gateway)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return 'http://127.0.0.1:' + str(self.server.server_address[1]) + '/place.parquet'

    def receipt(self):
        return {'url': self.part['url'], 'bytes': self.size, 'etag': self.etag, 'networkBytes': self.received,
                'reservedRequestBytes': self.requested, 'payloadBytesAreNotAProviderBillingMeasurement': True,
                'retryAfterUnix': self.retry_after_unix,
                'lastHttpStatus': self.last_http_status,
                'readAheadBytes': self.read_ahead_bytes, 'readAheadCanIncludeAdjacentColumns': bool(self.read_ahead_bytes),
                'cachedMemoryBytesReused': self.reused, 'ranges': self.ranges,
                'maximumNetworkBytes': self.maximum, 'maximumMemoryCacheBytes': MAX_CACHE,
                'fullFileSha256Verified': False, 'projectedColumnRead': True, 'rawFileSaved': False}

    def close(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.session.close()

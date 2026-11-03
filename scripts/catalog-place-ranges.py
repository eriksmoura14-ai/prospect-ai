"""Bounded public Places column reads without caching another whole raw file.

DuckDB talks only to loopback. Requests retains the inherited HTTPS proxy and
TLS trust. Source identity is the pinned URL, size, and consistent strong ETag;
range digests are recorded explicitly, never called a full-file SHA-256.
"""
import collections
import hashlib
import re
import shutil
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from pathlib import Path

import requests

MAX_CACHE = 16 * 1024 * 1024


def validate_range(start, end, size, maximum=32*1024*1024):
    if not (type(start) is int and type(end) is int and 0 <= start <= end < size and end - start + 1 <= maximum):
        raise RuntimeError('places_range_budget')


class PlaceRanges:
    def __init__(self, part, seconds=600, read_ahead_bytes=0, scratch_root=None, layer='place'):
        self.part = part
        parsed = urlsplit(part['url'])
        prefix = {'place': 'places/type=place', 'division_area': 'divisions/type=division_area'}.get(layer)
        if (prefix is None or parsed.scheme != 'https' or parsed.netloc != 'overturemaps-us-west-2.s3.us-west-2.amazonaws.com'
                or not re.fullmatch(r'/release/2026-10-21\.0/theme=' + re.escape(prefix or '') + r'/part-[0-9]{5}-[a-f0-9-]+-c000\.zstd\.parquet', parsed.path)
                or parsed.query or parsed.fragment or type(part['bytes']) is not int or not 0 < part['bytes'] < 900 * 1024 * 1024):
            raise ValueError('unreviewed_places_partition')
        self.size = part['bytes']
        # Division row groups measured at 39.8MB exceed the Places' 32MB
        # incoming window. Only this offline polygon worker gets 64MB; its
        # actual network blocks remain fixed at 4MB and reuse the same cache.
        self.maximum_window = (64 if layer=='division_area' else 32)*1024*1024
        if type(read_ahead_bytes) is not int or not 0 <= read_ahead_bytes <= 4 * 1024 * 1024:
            raise ValueError('places_read_ahead_budget')
        self.read_ahead_bytes = read_ahead_bytes
        self.maximum = self.size + 32 * 1024 * 1024
        self.deadline = time.monotonic() + seconds
        self.received = self.requested = self.reused = self.cache_bytes = 0
        self.memory_reused = self.scratch_reused = 0
        self.etag = None
        self.retry_after_unix = 0
        self.last_http_status = None
        self.ranges = []
        self.errors = []
        self.cache = collections.OrderedDict()
        self.scratch = tempfile.TemporaryDirectory(prefix='prospect-place-ranges-', dir=scratch_root)
        self.disk_entries = {}
        self.lock = threading.Lock()
        self.server = None
        self.session = requests.Session()

    def read(self, start, end):
        validate_range(start, end, self.size,self.maximum_window)
        with self.lock:
            if time.monotonic() > self.deadline:
                raise RuntimeError('places_range_deadline')
            if self.read_ahead_bytes:
                # Fixed, nonoverlapping blocks. An overlapping larger range
                # must not download the previous prefix a second time.
                pieces = []
                first = start // self.read_ahead_bytes * self.read_ahead_bytes
                while first <= end:
                    last = min(self.size - 1, first + self.read_ahead_bytes - 1)
                    block = self._range(first, last)
                    pieces.append(block[max(start, first)-first:min(end, last)-first+1])
                    first = last + 1
                return b''.join(pieces)
            return self._range(start, end)

    def _range(self, start, end):
        key = (start, end)
        if key in self.cache:
            self.cache.move_to_end(key)
            self.reused += end - start + 1
            self.memory_reused += end - start + 1
            return self.cache[key]
        if key in self.disk_entries:
            path, expected_sha = self.disk_entries[key]
            body = path.read_bytes()
            if len(body) != end-start+1 or hashlib.sha256(body).hexdigest() != expected_sha:
                raise RuntimeError('places_scratch_integrity')
            self.reused += len(body)
            self.scratch_reused += len(body)
            return body
        if shutil.disk_usage(self.scratch.name).free < end-start+1 + 32 * 1024 * 1024:
            raise RuntimeError('places_scratch_disk_reserve')
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
        checksum = hashlib.sha256(body).hexdigest()
        path = Path(self.scratch.name) / (str(start)+'-'+str(end))
        path.write_bytes(body)
        self.disk_entries[key] = (path, checksum)
        self.ranges.append({'start': start, 'end': end, 'sha256': checksum})
        if len(body) <= MAX_CACHE:
            while self.cache and self.cache_bytes + len(body) > MAX_CACHE:
                _, value = self.cache.popitem(last=False)
                self.cache_bytes -= len(value)
            self.cache[key] = body
            self.cache_bytes += len(body)
        return body

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
                'scratchBytes': sum(last-first+1 for first,last in self.disk_entries),
                'scratchRemovedOnClose': True,
                'cachedPayloadBytesReused': self.reused, 'cachedMemoryBytesReused': self.memory_reused,
                'cachedScratchBytesReused': self.scratch_reused, 'ranges': self.ranges,
                'maximumNetworkBytes': self.maximum, 'maximumMemoryCacheBytes': MAX_CACHE,
                'fullFileSha256Verified': False, 'projectedColumnRead': True, 'rawFileSaved': False}

    def close(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.session.close()
        self.scratch.cleanup()

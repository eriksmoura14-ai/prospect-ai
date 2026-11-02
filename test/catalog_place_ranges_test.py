import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('place_ranges', Path(__file__).resolve().parents[1] / 'scripts/catalog-place-ranges.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PART = {'id': '00014', 'bytes': 1000,
        'url': 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=places/type=place/part-00014-dcceff87-235e-5a0e-a4b4-5f25ccb873e7-c000.zstd.parquet'}


class ProjectedPlacesTransport(unittest.TestCase):
    def test_external_urls_new_releases_and_oversized_sources_are_rejected(self):
        for patch in ({'url': PART['url'].replace('2026-10-21.0', 'latest')},
                      {'url': PART['url'].replace('https://', 'http://')},
                      {'url': PART['url'] + '?secret=not-accepted'}, {'bytes': 900 * 1024 * 1024}):
            with self.assertRaises(ValueError):
                m.PlaceRanges({**PART, **patch})

    def test_invalid_ranges_cannot_escape_the_asset_or_size_budget(self):
        for start, end in ((-1, 4), (5, 4), (0, 1000), (0.0, 4), (0, 32 * 1024 * 1024)):
            with self.assertRaises(RuntimeError):
                m.validate_range(start, end, 1000)
        m.validate_range(0, 999, 1000)

    @staticmethod
    def response(start=0, end=3, etag='"immutable"', body=b'ABCD'):
        response = Mock(status_code=206, headers={'ETag': etag, 'Content-Range': f'bytes {start}-{end}/1000'})
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_content.return_value = [body]
        return response

    def test_repeated_ranges_reuse_bounded_memory_and_document_partial_hashes(self):
        source = m.PlaceRanges(PART)
        source.session.get = Mock(return_value=self.response())
        self.assertEqual(source.read(0, 3), b'ABCD')
        self.assertEqual(source.read(0, 3), b'ABCD')
        self.assertEqual(source.session.get.call_count, 1)
        receipt = source.receipt()
        self.assertEqual(receipt['networkBytes'], 4)
        self.assertEqual(receipt['cachedMemoryBytesReused'], 4)
        self.assertFalse(receipt['fullFileSha256Verified'])
        self.assertFalse(receipt['rawFileSaved'])
        self.assertEqual(len(receipt['ranges'][0]['sha256']), 64)
        source.close()

    def test_asset_change_truncation_and_non_range_response_stop_the_query(self):
        for response in (self.response(etag='W/"weak"'), self.response(body=b'A'), Mock(status_code=200)):
            source = m.PlaceRanges(PART)
            source.session.get = Mock(return_value=response)
            if response.status_code == 200:
                response.__enter__ = Mock(return_value=response)
                response.__exit__ = Mock(return_value=False)
            with self.assertRaises(RuntimeError):
                source.read(0, 3)
            source.close()
        source = m.PlaceRanges(PART)
        source.session.get = Mock(side_effect=[self.response(), self.response(4, 7, '"changed"')])
        source.read(0, 3)
        with self.assertRaisesRegex(RuntimeError, 'identity_changed'):
            source.read(4, 7)
        source.close()

    def test_budget_rejection_happens_before_the_network_call(self):
        source = m.PlaceRanges(PART)
        source.maximum = 3
        source.session.get = Mock()
        with self.assertRaises(RuntimeError):
            source.read(0, 3)
        source.session.get.assert_not_called()
        source.close()

    def test_read_ahead_reuses_contained_ranges_and_counts_the_extra_bytes(self):
        source = m.PlaceRanges(PART, read_ahead_bytes=4096)
        body = b'A' * 1000
        source.session.get = Mock(return_value=self.response(0, 999, body=body))
        self.assertEqual(source.read(0, 3), b'AAAA')
        self.assertEqual(source.read(300, 399), b'A' * 100)
        source.session.get.assert_called_once()
        self.assertEqual(source.receipt()['networkBytes'], 1000)
        self.assertEqual(source.receipt()['cachedMemoryBytesReused'], 100)
        self.assertTrue(source.receipt()['readAheadCanIncludeAdjacentColumns'])
        self.assertLessEqual(source.cache_bytes, m.MAX_CACHE)
        source.close()

    def test_source_rate_limit_records_retry_after_without_hidden_retries(self):
        source = m.PlaceRanges(PART)
        response = self.response()
        response.status_code = 429
        response.headers['Retry-After'] = '120'
        source.session.get = Mock(return_value=response)
        with self.assertRaisesRegex(RuntimeError, 'shared_cooldown'):
            source.read(0, 3)
        self.assertGreater(source.receipt()['retryAfterUnix'], 0)
        self.assertEqual(source.receipt()['networkBytes'], 0)
        source.session.get.assert_called_once()
        source.close()


if __name__ == '__main__':
    unittest.main()

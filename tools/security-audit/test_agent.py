"""Regression cases use only a local synthetic HTTP API and offline JWTs."""
import base64
import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import requests

MODULE = Path(__file__).parent / 'testing-api-authentication-weaknesses/scripts/agent.py'
spec = importlib.util.spec_from_file_location('fixed_auth_skill', MODULE)
skill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skill)


def jwt(header=None, payload=None, key=b'secret'):
    encode = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
    left = encode(header if header is not None else {'alg': 'HS256'})
    right = encode(payload if payload is not None else {'exp': int(time.time()) + 60, 'sub': 'FIXTURE-PRIVATE-SUBJECT'})
    signature = base64.urlsafe_b64encode(hmac.new(key, (left + '.' + right).encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return left + '.' + right + '.' + signature


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, body, content_type='application/json', headers=None):
        encoded = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(encoded)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'ok': True})
        if self.path == '/account':
            return self.reply(200, {'authenticated': False, 'user': None})
        if self.path == '/exposed':
            return self.reply(200, {'private': 'SYNTHETIC-PRIVATE-BODY'})
        if self.path == '/private':
            valid = self.server.active and 'original-fixture-cookie' in self.headers.get('Cookie', '')
            return self.reply(200 if valid else 401, {'private': 'SYNTHETIC-PRIVATE-BODY'} if valid else {'error': 'unauthorized'})
        if self.path == '/redirect':
            return self.reply(302, {}, headers={'Location': 'https://outside.invalid/never-visit'})
        if self.path == '/html':
            return self.reply(200, '<html>Login page</html>', 'text/html')
        if self.path == '/down':
            return self.reply(503, {'error': 'down'})
        if self.path == '/quota':
            return self.reply(429, {'error': 'quota'})
        if self.path == '/huge':
            return self.reply(200, 'x' * (skill.MAX_RESPONSE_BYTES + 1))
        return self.reply(404, {'error': 'not found'})

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or b'{}')
        if self.path.startswith('/login'):
            known = value.get('username') == 'known-fixture@example.test'
            if self.path == '/login-quota':
                return self.reply(429, {'error': 'quota'})
            if self.path == '/login-denied':
                return self.reply(403, {'error': 'CSRF rejected'})
            if self.path == '/login-invalid':
                return self.reply(400, {'error': 'bad field'})
            if self.path == '/login-array':
                return self.reply(401, ['different' if known else 'other'])
            if self.path == '/login-uniform':
                return self.reply(401, {'error': 'Invalid credentials', 'request_id': str(time.time_ns())})
            return self.reply(401, {'error': 'Wrong password' if known else 'Unknown user'})
        if self.path == '/logout':
            mode = self.server.logout_mode
            if mode == 'denied':
                return self.reply(403, {'error': 'CSRF rejected'})
            if mode == 'quota':
                return self.reply(429, {'error': 'quota'})
            if mode == 'body-error':
                return self.reply(200, {'error': 'logout failed'})
            if mode == 'revoke':
                self.server.active = False
            return self.reply(200, {'ok': True}, headers={'Set-Cookie': 'prospect_session=; Max-Age=0; Path=/'})
        return self.reply(404, {'error': 'not found'})


class SkillRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.worker = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.worker.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.worker.join(timeout=3)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.http.active, self.http.logout_mode = True, 'revoke'
        self.clients = []

    def agent(self, **kwargs):
        client = requests.Session()
        if kwargs.pop('authenticated', False):
            client.cookies.set('prospect_session', 'original-fixture-cookie')
        agent = skill.APIAuthTestAgent(self.base, self.temp.name, client=client, **kwargs)
        self.addCleanup(client.close)
        self.addCleanup(agent.anonymous_client.close)
        return agent

    def enum(self, agent, path='/login'):
        return agent.test_account_enumeration(path, known_identity='known-fixture@example.test',
                  unknown_identity='missing-fixture@example.test', invalid_password='intentionally-wrong', pause_seconds=0)

    def lifecycle(self, agent):
        return agent.test_token_after_logout(logout_path='/logout', protected_path='/private')

    def test_detects_distinct_http401_errors(self):
        agent = self.agent()
        self.assertTrue(self.enum(agent))
        self.assertEqual(agent.checks[-1]['outcome'], 'fail')

    def test_uniform_errors_ignore_unrelated_request_ids(self):
        agent = self.agent()
        self.assertIs(self.enum(agent, '/login-uniform'), False)
        self.assertEqual(agent.findings, [])

    def test_login_quota_is_inconclusive(self):
        agent = self.agent()
        self.assertIsNone(self.enum(agent, '/login-quota'))
        self.assertEqual(agent.checks[-1]['outcome'], 'inconclusive')

    def test_login_csrf_denial_is_inconclusive(self):
        self.assertIsNone(self.enum(self.agent(), '/login-denied'))

    def test_login_validation_error_is_inconclusive(self):
        self.assertIsNone(self.enum(self.agent(), '/login-invalid'))

    def test_unknown_rejection_schema_is_inconclusive(self):
        self.assertIsNone(self.enum(self.agent(), '/login-array'))

    def test_no_identities_does_not_claim_success(self):
        agent = self.agent()
        self.assertIsNone(agent.test_account_enumeration())
        self.assertEqual(agent.checks[-1]['outcome'], 'skipped')

    def test_rejected_logout_is_inconclusive(self):
        self.http.logout_mode = 'denied'
        agent = self.agent(authenticated=True, protected_paths=['/private'])
        self.assertIsNone(self.lifecycle(agent))
        self.assertEqual(agent.findings, [])
        self.assertTrue(self.http.active)

    def test_logout_quota_is_inconclusive(self):
        self.http.logout_mode = 'quota'
        self.assertIsNone(self.lifecycle(self.agent(authenticated=True, protected_paths=['/private'])))

    def test_logout_error_in_http200_is_inconclusive(self):
        self.http.logout_mode = 'body-error'
        self.assertIsNone(self.lifecycle(self.agent(authenticated=True, protected_paths=['/private'])))

    def test_lifecycle_needs_authenticated_baseline(self):
        self.assertIsNone(self.lifecycle(self.agent(protected_paths=['/private'])))

    def test_lifecycle_needs_declared_private_route(self):
        self.assertIsNone(self.lifecycle(self.agent(authenticated=True)))

    def test_successful_logout_rejects_old_cookie_replay(self):
        agent = self.agent(authenticated=True, protected_paths=['/private'])
        self.assertIs(self.lifecycle(agent), False)
        self.assertFalse(self.http.active)
        self.assertEqual(agent.checks[-1]['outcome'], 'pass')

    def test_client_cookie_deletion_does_not_hide_missing_revocation(self):
        self.http.logout_mode = 'clear-only'
        agent = self.agent(authenticated=True, protected_paths=['/private'])
        self.assertIs(self.lifecycle(agent), True)
        self.assertTrue(self.http.active)

    def test_bootstrap_and_health_are_public_by_policy(self):
        agent = self.agent(public_paths=['/health', '/account'])
        self.assertEqual(len(agent.test_unauthenticated_endpoints()), 2)
        self.assertEqual(agent.findings, [])

    def test_exposed_declared_private_api_is_detected(self):
        agent = self.agent(protected_paths=['/exposed'])
        agent.test_unauthenticated_endpoints()
        self.assertEqual(len(agent.findings), 1)

    def test_anonymous_scan_does_not_reuse_login_cookie(self):
        agent = self.agent(authenticated=True, protected_paths=['/private'])
        self.assertEqual(agent.test_unauthenticated_endpoints(), [])
        self.assertEqual(agent.checks[-1]['outcome'], 'pass')

    def test_unknown_exposure_policy_is_inconclusive(self):
        agent = self.agent()
        agent.test_unauthenticated_endpoints(['/exposed'])
        self.assertEqual(agent.findings, [])
        self.assertEqual(agent.checks[-1]['outcome'], 'inconclusive')

    def test_redirect_and_html_are_not_private_data_exposure(self):
        agent = self.agent(protected_paths=['/redirect', '/html'])
        agent.test_unauthenticated_endpoints()
        self.assertTrue(all(c['outcome'] == 'inconclusive' for c in agent.checks))
        self.assertEqual(agent.findings, [])

    def test_absent_route_provider_error_and_quota_do_not_claim_pass(self):
        agent = self.agent(protected_paths=['/absent', '/down', '/quota'])
        agent.test_unauthenticated_endpoints()
        self.assertTrue(all(c['outcome'] == 'inconclusive' for c in agent.checks))

    def test_transport_failure_is_incomplete_and_does_not_leak_exception(self):
        agent = self.agent(protected_paths=['/private'])
        with patch.object(agent.anonymous_client, 'request', side_effect=requests.ConnectionError('PRIVATE-EXCEPTION-DATA')):
            result = agent.generate_report(stdout=False)
        self.assertTrue(result['incomplete'])
        self.assertEqual(result['checks'][0]['outcome'], 'inconclusive')
        self.assertNotIn('PRIVATE-EXCEPTION-DATA', json.dumps(result))

    def test_oversized_response_is_inconclusive(self):
        agent = self.agent(protected_paths=['/huge'])
        agent.test_unauthenticated_endpoints()
        self.assertEqual(agent.checks[-1]['outcome'], 'inconclusive')

    def test_report_runs_configured_enumeration_and_lifecycle(self):
        agent = self.agent(authenticated=True, public_paths=['/health'], protected_paths=['/private'])
        result = agent.generate_report(stdout=False,
                  enumeration={'login_path': '/login-uniform', 'known_identity': 'known-fixture@example.test', 'unknown_identity': 'missing-fixture@example.test', 'invalid_password': 'intentionally-wrong', 'pause_seconds': 0},
                  lifecycle={'logout_path': '/logout', 'protected_path': '/private'})
        outcomes = {c['name']: c['outcome'] for c in result['checks']}
        self.assertEqual(outcomes['account_enumeration'], 'pass')
        self.assertEqual(outcomes['logout_revocation'], 'pass')
        self.assertEqual(outcomes['jwt'], 'skipped')
        self.assertTrue(result['incomplete'])

    def test_missing_checks_are_reported_as_skipped(self):
        result = self.agent(public_paths=['/health']).generate_report(stdout=False)
        self.assertTrue(result['incomplete'])
        self.assertEqual(len([c for c in result['checks'] if c['outcome'] == 'skipped']), 3)

    def test_declared_cookie_auth_marks_jwt_not_applicable(self):
        agent = self.agent(public_paths=['/health'], protected_paths=['/private'], authenticated=True)
        result = agent.generate_report(stdout=False, jwt_applicable=False,
                   enumeration={'login_path': '/login-uniform', 'known_identity': 'known-fixture@example.test', 'unknown_identity': 'missing-fixture@example.test', 'invalid_password': 'intentionally-wrong', 'pause_seconds': 0},
                   lifecycle={'logout_path': '/logout', 'protected_path': '/private'})
        self.assertFalse(result['incomplete'])
        self.assertEqual(result['checks'][-1]['outcome'], 'not_applicable')
        with self.assertRaises(ValueError):
            agent.generate_report(jwt(), jwt_applicable=False, stdout=False)

    def test_jwt_findings_and_stdout_redact_keys_claims_and_response_bodies(self):
        agent = self.agent(public_paths=['/health'])
        token = jwt(payload={'exp': int(time.time()) + 60, 'secret': 'FIXTURE-SECRET-VALUE', 'sub': 'FIXTURE-PRIVATE-SUBJECT'})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            report = agent.generate_report(token)
        for forbidden in [token, 'FIXTURE-SECRET-VALUE', 'FIXTURE-PRIVATE-SUBJECT', 'SYNTHETIC-PRIVATE-BODY']:
            self.assertNotIn(forbidden, output.getvalue())
        self.assertIs(report['common_key_matched'], True)
        self.assertEqual((Path(self.temp.name) / 'api_auth_report.json').stat().st_mode & 0o777, 0o600)

    def test_malformed_jwts_and_expiration_types_do_not_crash(self):
        agent = self.agent()
        for value in [None, '', 'a.b.c', jwt(header=[]), jwt(header={'alg': []}), jwt(payload=[]), jwt(payload={'exp': 'soon'}), jwt(payload={'exp': True}), jwt(payload={'exp': 10**500}), jwt() + '\u2603']:
            agent.analyze_jwt(value)
            agent.brute_force_jwt_secret(value)

    def test_report_run_does_not_accumulate_old_findings(self):
        agent = self.agent(public_paths=['/health'])
        agent._finding('high', 'old', 'old')
        self.assertEqual(agent.generate_report(stdout=False)['findings'], [])
        self.assertEqual(agent.generate_report(stdout=False)['findings'], [])

    def test_route_and_origin_validation_prevents_credential_leakage(self):
        for path in ['//outside.invalid', '/a?token=secret', '/a#fragment', '/x\\y', '/x\r\nHeader: bad', '/\u2603']:
            with self.assertRaises(ValueError):
                self.agent()._get(path)
        for base in ['file:///etc/passwd', 'https://user:pass@example.test', self.base + '/api', self.base + '?token=secret']:
            with self.assertRaises(ValueError):
                skill.APIAuthTestAgent(base)
        with self.assertRaises(ValueError):
            self.agent(public_paths=['/health'], protected_paths=['/health'])


if __name__ == '__main__':
    unittest.main(verbosity=2)

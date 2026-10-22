#!/usr/bin/env python3
"""Local corrected derivative of mukul975's authentication skill (Apache-2.0).

Modified for explicit route policy, real failed-login responses, logout
preconditions, cookie replay, bounded transport and credential-free reports.
See ../../NOTICE.md for provenance. This is not an upstream release.
"""
import argparse
import base64
import hashlib
import hmac
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import requests

COMMON_JWT_SECRETS = (
    "secret", "password", "123456", "jwt_secret", "supersecret", "key", "test",
    "admin", "changeme", "default", "your-256-bit-secret", "my-secret-key",
    "jwt-secret", "s3cr3t", "secret123", "mysecretkey", "apisecret",
)
MAX_RESPONSE_BYTES = 65536


class APIAuthTestAgent:
    def __init__(self, base_url, output_dir="./api_auth_test", *, public_paths=(),
                 protected_paths=(), client=None):
        origin = urlsplit(base_url)
        if origin.scheme not in ("http", "https") or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/"):
            raise ValueError("Use an HTTP(S) origin without credentials, path or query")
        self.base_url = base_url.rstrip("/")
        self.output_dir = Path(output_dir)
        self.client = client if client is not None else requests.Session()
        self.anonymous_client = requests.Session()
        self.public_paths = set(public_paths)
        self.protected_paths = set(protected_paths)
        if self.public_paths & self.protected_paths:
            raise ValueError("Public and protected route policies overlap")
        for path in self.public_paths | self.protected_paths:
            self._url(path)
        self.findings, self.checks = [], []

    def _url(self, path):
        if not isinstance(path, str) or not path.startswith("/") or path.startswith("//") or any(c in path for c in "\\?#\r\n\x00") or not path.isascii():
            raise ValueError("Use an ASCII relative route without query, fragment or controls")
        if any(ord(c) < 32 or ord(c) == 127 for c in path):
            raise ValueError("Control characters are not allowed in route paths")
        return self.base_url + path

    def _request(self, method, path, *, headers=None, data=None, timeout=10, client=None):
        url = self._url(path)
        try:
            transport = self.client if client is None else client
            with transport.request(method, url, json=data, headers=headers,
                                     timeout=timeout, allow_redirects=False, stream=True) as response:
                chunks, size = [], 0
                deadline = time.monotonic() + timeout
                for chunk in response.iter_content(8192):
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES or time.monotonic() > deadline:
                        return None
                    chunks.append(chunk)
                response._content = b"".join(chunks)
                response._content_consumed = True
                return response
        except requests.RequestException:
            # No exception text: provider errors can include credentials or URLs.
            return None

    def _get(self, path, headers=None, timeout=10):
        return self._request("GET", path, headers=headers, timeout=timeout)

    def _post(self, path, data=None, headers=None, timeout=10):
        return self._request("POST", path, data=data, headers=headers, timeout=timeout)

    def _check(self, name, outcome, reason, **metadata):
        self.checks.append({"name": name, "outcome": outcome, "reason": reason, **metadata})

    def _finding(self, severity, kind, detail):
        self.findings.append({"severity": severity, "type": kind, "detail": detail})

    def test_unauthenticated_endpoints(self, paths=None):
        paths = sorted(self.public_paths | self.protected_paths) if paths is None else paths
        opened = []
        for path in paths:
            self._url(path)
            response = self._request('GET', path, client=self.anonymous_client)
            if response is None:
                self._check(path, "inconclusive", "Transport, deadline or body limit")
                continue
            status = response.status_code
            if 300 <= status < 400 or status >= 500 or status == 429:
                self._check(path, "inconclusive", "Redirect, provider error or quota", status=status)
            elif path in self.public_paths:
                outcome = "pass" if 200 <= status < 300 else "inconclusive"
                self._check(path, outcome, "Explicit public-route policy", status=status)
                if outcome == "pass":
                    opened.append({"path": path, "status": status, "policy": "public"})
            elif path not in self.protected_paths:
                self._check(path, "inconclusive", "No route exposure policy", status=status)
            elif status in (401, 403):
                self._check(path, "pass", "Anonymous request denied", status=status)
            elif 200 <= status < 300:
                content_type = response.headers.get("content-type", "").lower()
                if "json" not in content_type:
                    self._check(path, "inconclusive", "Successful non-JSON response; verify route identity", status=status)
                    continue
                opened.append({"path": path, "status": status, "policy": "protected"})
                self._finding("high" if "/admin" in path else "medium", "Unauthenticated Access",
                              f"Declared protected route {path} returned HTTP {status}")
                self._check(path, "fail", "Declared protected API route accessible", status=status)
            else:
                self._check(path, "inconclusive", "Route existence or contract not established", status=status)
        return opened

    def decode_jwt(self, token):
        if not isinstance(token, str) or len(token) > 16384:
            return None, None
        parts = token.split(".")
        if len(parts) != 3:
            return None, None
        if any(not part.isascii() or any(not (char.isalnum() or char in '_-') for char in part) for part in parts):
            return None, None
        try:
            decode = lambda part: json.loads(base64.b64decode(part + "=" * (-len(part) % 4), altchars=b"-_", validate=True))
            header, payload = decode(parts[0]), decode(parts[1])
            return (header, payload) if isinstance(header, dict) and isinstance(payload, dict) else (None, None)
        except (ValueError, UnicodeError):
            return None, None

    def analyze_jwt(self, token):
        header, payload = self.decode_jwt(token)
        if header is None:
            self._check("jwt", "inconclusive", "Invalid JWT encoding or object structure")
            return {"error": "Invalid JWT", "issues": []}
        issues = []
        if header.get("alg") == "none":
            issues.append({"severity": "high", "issue": "Unsigned JWT presented; server acceptance must be tested separately"})
        if "exp" not in payload:
            issues.append({"severity": "medium", "issue": "No expiration claim in supplied token"})
        elif isinstance(payload['exp'], bool) or not isinstance(payload['exp'], (int, float)) or abs(payload['exp']) > 10**15 or not math.isfinite(payload['exp']):
            issues.append({"severity": "medium", "issue": "Expiration claim is not a finite NumericDate"})
        elif payload['exp'] - time.time() > 86400:
            issues.append({"severity": "info", "issue": "Token TTL exceeds 24 hours; assess against session policy"})
        sensitive = [key for key in ("password", "ssn", "credit_card", "secret", "private_key") if key in payload]
        for field in sensitive:
            issues.append({"severity": "high", "issue": f"Sensitive field '{field}' present in supplied token"})
        for issue in issues:
            self._finding(issue['severity'], 'JWT Observation', issue['issue'])
        self._check("jwt", "observation" if issues else "pass", "Offline token inspection; signature acceptance not tested")
        # Never include header, claims, token, subject or signing key in a report.
        return {"issues": issues, "claims_redacted": True}

    def brute_force_jwt_secret(self, token):
        header, _ = self.decode_jwt(token)
        alg = header.get('alg') if header is not None else None
        algorithms = {'HS256': hashlib.sha256, 'HS384': hashlib.sha384, 'HS512': hashlib.sha512}
        if not isinstance(alg, str) or alg not in algorithms:
            self._check('jwt_common_keys', 'skipped', 'No supported HMAC token supplied')
            return None
        head, payload, signature = token.split('.')
        for secret in COMMON_JWT_SECRETS:
            digest = hmac.new(secret.encode(), (head + '.' + payload).encode(), algorithms[alg]).digest()
            if hmac.compare_digest(base64.urlsafe_b64encode(digest).decode().rstrip('='), signature):
                self._finding('critical', 'Weak JWT Secret', 'Supplied JWT matches a common signing key; key omitted')
                self._check('jwt_common_keys', 'fail', 'Common signing key confirmed offline')
                return True
        self._check('jwt_common_keys', 'pass', 'No match among the bounded common-key list; not a strength guarantee')
        return False

    def test_token_after_logout(self, token=None, logout_path='/auth/logout', *,
                                protected_path='/users/me', headers=None):
        if protected_path not in self.protected_paths:
            self._check('logout_revocation', 'inconclusive', 'A declared protected route is required')
            return None
        auth_headers = dict(headers or {})
        if token is not None:
            auth_headers['Authorization'] = 'Bearer ' + token
        prepared = self.client.prepare_request(requests.Request('GET', self._url(protected_path), headers=auth_headers))
        replay_headers = dict(prepared.headers)
        # Authenticate before logout and retain the original Cookie header so
        # deleting a client cookie cannot be mistaken for server revocation.
        initial = self._get(protected_path, headers=replay_headers)
        if initial is None or initial.status_code != 200 or 'json' not in initial.headers.get('content-type', '').lower():
            self._check('logout_revocation', 'inconclusive', 'Authenticated private-API baseline not established')
            return None
        logout = self._post(logout_path, headers=auth_headers)
        if logout is None or logout.status_code not in (200, 204):
            self._check('logout_revocation', 'inconclusive', 'Logout did not succeed', status=logout.status_code if logout is not None else None)
            return None
        if logout.status_code == 200:
            try:
                body = logout.json()
                if isinstance(body, dict) and ('error' in body or body.get('ok') is False or body.get('success') is False):
                    self._check('logout_revocation', 'inconclusive', 'Logout body reports failure', status=200)
                    return None
            except ValueError:
                self._check('logout_revocation', 'inconclusive', 'Unrecognized logout response contract', status=200)
                return None
        replay = self._get(protected_path, headers=replay_headers)
        if replay is not None and replay.status_code in (401, 403):
            self._check('logout_revocation', 'pass', 'Original credential rejected after successful logout', status=replay.status_code)
            return False
        if replay is not None and replay.status_code == 200 and 'json' in replay.headers.get('content-type', '').lower():
            self._finding('high', 'Token Not Revoked', 'Original credential still accesses a protected API after successful logout')
            self._check('logout_revocation', 'fail', 'Original credential accepted after logout', status=200)
            return True
        self._check('logout_revocation', 'inconclusive', 'Replay did not establish acceptance or rejection', status=replay.status_code if replay is not None else None)
        return None

    def test_account_enumeration(self, login_path='/auth/login', *, known_identity=None,
                                  unknown_identity=None, invalid_password=None,
                                  identity_field='username', headers=None, pause_seconds=.6):
        if not all(isinstance(x, str) and x for x in (known_identity, unknown_identity, invalid_password)) or known_identity == unknown_identity:
            self._check('account_enumeration', 'skipped', 'Provide a known test identity, absent identity and deliberately invalid password')
            return None
        responses = []
        for identity in (known_identity, unknown_identity):
            time.sleep(max(0, min(pause_seconds, 5)))
            responses.append(self._request('POST', login_path, data={identity_field: identity, 'password': invalid_password}, headers=headers, client=self.anonymous_client))
        if any(response is None for response in responses):
            self._check('account_enumeration', 'inconclusive', 'Transport or response limit')
            return None
        statuses = [response.status_code for response in responses]
        if any(status not in (401, 403, 404) for status in statuses) or statuses == [403, 403] or statuses == [404, 404]:
            self._check('account_enumeration', 'inconclusive', 'Credential rejection not established; check CSRF, route and quota', statuses=statuses)
            return None
        signatures = []
        for response in responses:
            try:
                body = response.json()
                signatures.append({key: body[key] for key in ('error', 'message') if key in body} if isinstance(body, dict) else None)
            except ValueError:
                signatures.append(None)
        if not all(signatures):
            self._check('account_enumeration', 'inconclusive', 'Unrecognized rejection response contract', statuses=statuses)
            return None
        differs = statuses[0] != statuses[1] or signatures[0] != signatures[1]
        if differs:
            self._finding('medium', 'Account Enumeration', 'Known and absent test identities receive distinguishable rejection responses; values omitted')
        self._check('account_enumeration', 'fail' if differs else 'pass', 'Compared credential-rejection status and error/message fields; timing not assessed', statuses=statuses)
        return differs

    def generate_report(self, token=None, *, paths=None, enumeration=None, lifecycle=None, jwt_applicable=True, stdout=True):
        if not jwt_applicable and token is not None:
            raise ValueError('JWT data conflicts with an explicitly non-JWT authentication policy')
        # Each run starts fresh: findings from earlier calls must not be repeated.
        self.findings, self.checks = [], []
        unauth = self.test_unauthenticated_endpoints(paths)
        if enumeration is not None:
            self.test_account_enumeration(**enumeration)
        else:
            self._check('account_enumeration', 'skipped', 'No test identities configured')
        if lifecycle is not None:
            self.test_token_after_logout(**lifecycle)
        else:
            self._check('logout_revocation', 'skipped', 'No authenticated lifecycle check configured')
        analysis, weak = None, None
        if token is not None:
            analysis = self.analyze_jwt(token)
            weak = self.brute_force_jwt_secret(token)
        elif jwt_applicable:
            self._check('jwt', 'skipped', 'No JWT supplied; cookie sessions do not require JWT')
        else:
            self._check('jwt', 'not_applicable', 'Declared opaque-cookie authentication')
        report = {'report_date': datetime.now(timezone.utc).isoformat(), 'base_url': self.base_url,
                  'unauthenticated_endpoints': unauth, 'jwt_analysis': analysis,
                  'common_key_matched': weak, 'findings': list(self.findings), 'checks': list(self.checks),
                  'total_findings': len(self.findings),
                  'incomplete': any(item['outcome'] in ('inconclusive', 'skipped') for item in self.checks)}
        self.output_dir.mkdir(parents=True, exist_ok=True)
        path = self.output_dir / 'api_auth_report.json'
        # A new report replaces the old one with restrictive permissions.
        temporary = self.output_dir / ('.report-' + os.urandom(8).hex())
        try:
            with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as handle:
                json.dump(report, handle, indent=2)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        if stdout:
            print(json.dumps(report, indent=2))
        return report


def main():
    parser = argparse.ArgumentParser(description='Configured authentication observations; see checks for incomplete coverage.')
    parser.add_argument('base_url')
    parser.add_argument('--public-path', action='append', default=[])
    parser.add_argument('--protected-path', action='append', default=[])
    parser.add_argument('--output-dir', default='./api_auth_test')
    parser.add_argument('--token-env', help='Name of an environment variable containing an optional JWT; never pass a token on the command line')
    args = parser.parse_args()
    if not args.public_path and not args.protected_path:
        parser.error('Declare public and/or protected routes explicitly')
    token = os.environ.get(args.token_env) if args.token_env else None
    if args.token_env and token is None:
        parser.error('The named token environment variable is not configured')
    agent = APIAuthTestAgent(args.base_url, args.output_dir, public_paths=args.public_path, protected_paths=args.protected_path)
    report = agent.generate_report(token)
    return 1 if report['findings'] else 2 if report['incomplete'] else 0


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Run the corrected helper against disposable Prospect browser fixtures.

Requires the project's local fixture server, not a production login. No mail or
company queries are performed. Fixture credentials stay in memory.
"""
import argparse
import importlib.util
import json
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests

ROOT = Path(__file__).resolve().parent
MODULE = ROOT / 'testing-api-authentication-weaknesses/scripts/agent.py'
spec = importlib.util.spec_from_file_location('prospect_corrected_auth_skill', MODULE)
skill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skill)


def run(base, output):
    target = urlsplit(base)
    if target.scheme != 'http' or target.hostname != '127.0.0.1' or target.username or target.password or target.path not in ('', '/') or target.query or target.fragment:
        raise ValueError('Use the disposable fixture on http://127.0.0.1:<port>')
    base = base.rstrip('/')
    initial = requests.get(base + '/__test/info', timeout=10)
    initial.raise_for_status()
    fixture = initial.json()['desktop']
    checks = []

    def check(name, actual, expected):
        checks.append({'name': name, 'outcome': 'pass' if actual == expected else 'fail',
                       'actual': actual, 'expected': expected})
        if actual != expected:
            raise AssertionError(name)

    clients = []
    agent = None
    try:
        def login(who):
            client = requests.Session()
            clients.append(client)
            profile = client.get(base + '/api/account', timeout=10).json()
            headers = {'Origin': base, 'Sec-Fetch-Site': 'same-origin', 'x-csrf-token': profile['csrfToken']}
            time.sleep(.6)
            response = client.post(base + '/api/auth/login', json={
                'email': fixture[who]['email'], 'password': fixture['password']}, headers=headers, timeout=10)
            check('Login with disposable fixture: ' + who, response.status_code, 200)
            return client

        alice, bob = login('alice'), login('bob')
        private_paths = ['/api/history', '/api/lists', '/api/niches', '/api/diagnostics/overpass']
        agent = skill.APIAuthTestAgent(base, output, public_paths=['/health', '/api/account'],
                                      protected_paths=private_paths, client=alice)
        profile = agent.anonymous_client.get(base + '/api/account', timeout=10).json()
        check('Anonymous bootstrap has no identity', profile['user'], None)
        check('Anonymous bootstrap is not authenticated', profile['authenticated'], False)
        anon_headers = {'Origin': base, 'Sec-Fetch-Site': 'same-origin', 'x-csrf-token': profile['csrfToken']}
        for path in ['/api/history', '/api/lists', '/api/niches']:
            check('Authenticated route baseline: ' + path, alice.get(base + path, timeout=10).status_code, 200)
        check('Owner search baseline', alice.get(base + '/api/jobs/' + fixture['jobId'], timeout=10).status_code, 200)
        check('Other account cannot read owner search', bob.get(base + '/api/jobs/' + fixture['jobId'], timeout=10).status_code, 404)
        check('Regular account cannot read administrator diagnostics', alice.get(base + '/api/diagnostics/overpass', timeout=10).status_code, 404)
        for path in ['/.env', '/server.cjs', '/db/schema.sql']:
            check('Private source denied: ' + path, requests.get(base + path, timeout=10).status_code, 404)
        for name, headers in [
            ('Cross-origin login denied', {**anon_headers, 'Origin': 'https://external.example'}),
            ('Invalid CSRF login denied', {**anon_headers, 'x-csrf-token': 'invalid'})
        ]:
            time.sleep(.6)
            response = agent.anonymous_client.post(base + '/api/auth/login', json={
                'email': fixture['alice']['email'], 'password': fixture['password']}, headers=headers, timeout=10)
            check(name, response.status_code, 403)

        token = alice.cookies.get('prospect_session')
        cookie = next(item for item in alice.cookies if item.name == 'prospect_session')
        check('256-bit opaque session cookie shape', len(token) == 43 and '.' not in token, True)
        check('HttpOnly cookie', 'HttpOnly' in cookie._rest, True)
        check('SameSite cookie', cookie._rest.get('SameSite'), 'Lax')
        check('URL token does not authenticate', requests.get(base + '/api/history', params={'token': token}, timeout=10).status_code, 401)
        check('Bearer token does not bypass cookies', requests.get(base + '/api/history', headers={'Authorization': 'Bearer ' + token}, timeout=10).status_code, 401)
        check('Duplicate cookies rejected', requests.get(base + '/api/history', headers={'Cookie': f'prospect_session={token}; prospect_session={token}'}, timeout=10).status_code, 401)
        auth_profile = alice.get(base + '/api/account', timeout=10).json()
        logout_headers = {'Origin': base, 'Sec-Fetch-Site': 'same-origin', 'x-csrf-token': auth_profile['csrfToken']}
        response = alice.post(base + '/auth/logout', headers={**logout_headers, 'x-csrf-token': 'invalid'}, timeout=10)
        check('Rejected logout is actually denied', response.status_code, 403)
        check('Rejected logout preserves legitimate session', alice.get(base + '/api/history', timeout=10).status_code, 200)
        result = agent.generate_report(stdout=False, jwt_applicable=False,
                    enumeration={'login_path': '/api/auth/login', 'known_identity': fixture['alice']['email'],
                                 'unknown_identity': 'absent' + secrets.token_hex(10) + '@gmail.com',
                                 'invalid_password': 'Deliberately invalid fixture password 2026!',
                                 'identity_field': 'email', 'headers': anon_headers},
                    lifecycle={'logout_path': '/auth/logout', 'protected_path': '/api/history', 'headers': logout_headers})
        result['project_checks'] = checks
        result['scope'] = 'Disposable Prospect fixture on loopback, with PostgreSQL and two regular accounts'
        result['runtime_changed'] = False
        outcomes = [item['outcome'] for item in result['checks'] + checks]
        result['summary'] = {'passed': outcomes.count('pass'), 'failed': outcomes.count('fail'),
                             'inconclusive': outcomes.count('inconclusive'), 'skipped': outcomes.count('skipped'),
                             'not_applicable': outcomes.count('not_applicable')}
        for client in [bob]:
            state = client.get(base + '/api/account', timeout=10).json()
            client.post(base + '/auth/logout', headers={'Origin': base, 'Sec-Fetch-Site': 'same-origin', 'x-csrf-token': state['csrfToken']}, timeout=10)
        destination = Path(output) / 'prospect_auth_report.json'
        with destination.open('w') as handle:
            json.dump(result, handle, indent=2)
        destination.chmod(0o600)
        print(json.dumps({'summary': result['summary'], 'findings': result['findings'],
                          'report': str(destination)}, indent=2))
        return 1 if result['findings'] or result['summary']['failed'] else 2 if result['incomplete'] else 0
    finally:
        if agent is not None:
            agent.anonymous_client.close()
        for client in clients:
            client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:3161')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'reports')
    arguments = parser.parse_args()
    raise SystemExit(run(arguments.base_url, arguments.output_dir))

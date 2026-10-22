---
name: testing-api-authentication-weaknesses
description: 'Tests API authentication mechanisms for weaknesses including broken
  token validation, missing authentication on endpoints, weak password policies, credential
  stuffing susceptibility, token leakage in URLs or logs, and session management flaws.
  The tester evaluates JWT implementation, API key handling, OAuth flows, and session
  token entropy to identify authentication bypasses. Maps to OWASP API2:2023 Broken
  Authentication. Activates for requests involving API authentication testing, token
  validation assessment, credential security testing, or API auth bypass.

  '
domain: cybersecurity
subdomain: api-security
tags:
- api-security
- owasp
- authentication
- jwt
- session-management
- credential-security
version: 1.0.0
author: mahipal
license: Apache-2.0
nist_csf:
- PR.PS-01
- ID.RA-01
- PR.DS-10
- DE.CM-01
mitre_attack:
- T1190
- T1059.007
- T1552.001
- T1003
- T1110
---
# Testing API Authentication Weaknesses — corrected local derivative

This independently modified copy is based on the community catalog identified
in [NOTICE.md](../NOTICE.md). Preserve the Apache-2.0 license. It is not an
upstream or Anthropic-endorsed release.

## Scope and prerequisites

Use only against a system owned by the operator or explicitly authorized for
this assessment. Establish target, route policy and disposable test identities
before requests. For Prospect AI, use the local PostgreSQL/fixture workflow in
[README.md](../README.md); it does not target production accounts or send mail.

The helper requires Python 3.10+ and requests. Missing dependencies must fail
visibly rather than returning an empty findings list. JWT tests apply only when
a JWT is actually supplied; opaque cookie sessions are assessed as cookies.

## Workflow

1. Identify authentication from the application code or documented protocol.
   Record which routes are intentionally public and which require a session.
   Never infer exposure solely from a generic HTTP 200 response.
2. Construct `APIAuthTestAgent` with `public_paths` and `protected_paths`. The
   anonymous client is independent from the authenticated client. URLs must use
   the selected HTTP(S) origin; credentials, query strings and fragments are not
   accepted in route configuration. Redirects are not followed.
3. For failed-login checks, provide a known disposable identity, an absent
   identity, a deliberately invalid password, the correct identity field and
   required Origin/CSRF headers. `test_account_enumeration` compares real HTTP
   rejection statuses and JSON error/message fields, including 401 responses.
   Quota responses, failed transport, bad schema and CSRF rejection are
   inconclusive, not evidence that enumeration is absent. Timing is not assessed.
4. For logout, use an authenticated test client and a declared protected API
   route. Establish successful access before POSTing to logout with its correct
   Origin/CSRF headers. If logout is refused or reports failure, stop with an
   inconclusive result. After successful logout, replay the original cookie or
   token retained before the call. Deletion of a browser cookie alone does not
   prove server-side revocation.
5. If a JWT is supplied, inspect it offline. Malformed structures and expiration
   types must not crash the helper. A supplied alg=none token is an observation,
   not proof that the server accepts unsigned tokens. A bounded common-key match
   is recorded without printing the recovered key. Do not include header,
   payload, subject, token or key values in reports.
6. Call `generate_report` with configured `enumeration` and `lifecycle` options
   to execute them as part of the run. For declared opaque-cookie authentication,
   pass `jwt_applicable=False`. Omitted tests are skipped; transport, redirects,
   absent routes, provider failures and unrecognized contracts are inconclusive.
7. Confirm findings with a scoped reproduction and distinguish them from
   application policy. Password policy, OAuth, MFA, administrator permissions and
   network-layer protections require separate checks unless actually exercised.
   Do not claim they passed from an empty findings list.

## Results

Each check records pass, fail, inconclusive, skipped, observation or not_applicable.
`incomplete` is true when a configured workflow has inconclusive or skipped
coverage. Output contains route/status metadata and sanitized findings only.

The CLI returns 1 for findings, 2 for incomplete coverage, and 0 only when the
configured checks complete without findings. The generic CLI does not create
sessions or accounts. Use the included Prospect adapter to exercise its local
cookie/CSRF flow instead of assuming Bearer/JWT authentication.

## Local verification

Run `python -m unittest discover -s . -p test_agent.py -v` from the package root.
The controls must detect distinguishable HTTP 401 login failures, avoid an alert
for a refused logout, detect cookie deletion without server revocation, and
honor intentionally public routes. They also cover invalid JWT data, report
redaction, missing route policy, provider errors and anonymous-client isolation.

See [API reference](references/api-reference.md), the package README and the
machine-readable reports for the exact coverage of the latest test run.

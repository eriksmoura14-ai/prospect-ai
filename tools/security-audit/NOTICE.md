# Local corrected derivative

Based on `testing-api-authentication-weaknesses` from
https://github.com/mukul975/Anthropic-Cybersecurity-Skills at commit
`54a798831d2266a3ca61ce68a7acb80b81160d57`, author `mahipal` in the original
skill metadata. Original code and documentation are licensed under Apache-2.0;
the original license is preserved in the skill directory.

Modified locally for Prospect AI on 22 October 2026. This package is an
independent derivative, not a release endorsed by Anthropic or the upstream author.

Changes: analyze real HTTP rejection responses without response-object truthiness;
require successful authenticated baseline and logout before checking revocation;
replay the original cookie; use explicit public/protected route policies and a
separate anonymous client; report missing/failed prerequisites as incomplete;
avoid redirects, response-body/claim/key disclosure and accumulated old results;
execute configured enumeration and lifecycle checks from the report workflow.
Added local regression cases and an adapter for disposable Prospect fixtures.

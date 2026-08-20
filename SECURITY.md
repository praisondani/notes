# Security policy

Set `AUTH_PASSWORD` and a long random `AUTH_SECRET` before exposing an instance to a network. Put Cinder behind HTTPS and a reverse proxy. Keep object-store credentials server-side and grant only the bucket permissions Cinder needs.

Please do not report vulnerabilities in public issues. Send a private report to the repository maintainers with reproduction steps, impact, and a proposed mitigation.

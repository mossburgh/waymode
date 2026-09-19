# Security

Report a suspected vulnerability through [GitHub private vulnerability
reporting](https://github.com/mossburgh/waymode/security/advisories/new). Include
the affected version, a minimal reproduction, and the expected boundary. Keep
credentials and private app data out of public issues.

Waymode does not grant authority. The host must check the current user, resource,
input, and required confirmation at the point of each write. A model score and a
browser discovery root cannot replace authorization. Keep model credentials on
the server; never expose them through a public environment variable.

The repository ignores environment files, local session state, and generated
artifacts. Only the blank `.env.example` is tracked. CI scans Git history for known secret patterns. This does not establish that
all private information is absent. The publication scanner also checks local
paths, media, and the maintainer's private identifier policy.

## Host development servers

Demo apps and their server fixtures live outside this repository. Host development
servers must restrict source-file access to the directories they need and deny
credentials, session state, and local artifacts. This SDK does not configure a
host's development server or certify its deployment security.

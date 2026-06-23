# TITAN Enterprise — Commercial License

Copyright (c) 2026 Sharvik Sutar. All rights reserved.

This license governs the **TITAN Enterprise** components of this project — the
files marked with a `//go:build enterprise` constraint and/or a header reading
`TITAN Enterprise — commercial license`, and any other components identified as
Enterprise in [EDITIONS.md](EDITIONS.md) (collectively, the "Enterprise
Software"). The Enterprise Software is **NOT** covered by the MIT [LICENSE](LICENSE)
that applies to the rest of this repository (the "Community Software").

> This is a placeholder summary of commercial terms, not final legal text. Have
> a lawyer review before any commercial sale or distribution.

## Grant

The Enterprise Software is licensed, not sold. Subject to a valid, paid
subscription or license agreement with the copyright holder ("Licensor"),
Licensor grants the customer a non-exclusive, non-transferable, revocable license
to use the Enterprise Software solely for the customer's internal business
purposes, for the term and seat/usage count specified in that agreement.

## Restrictions

Without a separate written agreement with the Licensor, you may **not**:

1. Use the Enterprise Software in production without a valid license key.
2. Copy, redistribute, sublicense, sell, rent, lease, or host the Enterprise
   Software for third parties.
3. Modify, reverse engineer, or create derivative works of the Enterprise
   Software, except as permitted by applicable law.
4. Remove or alter any license, copyright, or proprietary notices.
5. Circumvent, disable, or tamper with the edition / license enforcement
   (`gateway/internal/edition`, the `enterprise` build tag, or the runtime gate).

## The Community Software is unaffected

Nothing here restricts your rights under the MIT [LICENSE](LICENSE) to the
Community Software. The open-core build (`go build ./...`) contains none of the
Enterprise Software and is free to use, modify, and redistribute under MIT.

## Warranty & liability

THE ENTERPRISE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. To the
maximum extent permitted by law, the Licensor shall not be liable for any
damages arising from the use of the Enterprise Software. A signed commercial
agreement, where present, supersedes this section.

## Contact

Commercial licensing & enterprise inquiries: **sharviksutar@gmail.com**

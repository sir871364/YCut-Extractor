# Privacy Policy

YCUT Blue User Scanner assists users in scanning, identifying, and exporting information from the YCUT website.

## YCUT Website Data and Local Processing

The extension's primary scanning, highlighting, data processing, PDF export, and JSON export functions run locally in the user's browser. YCUT website content processed by these functions is not sent to the license server.

The extension communicates with YCUT website services as needed to retrieve information requested by the user. Those communications are separate from license verification and remain subject to the YCUT website's own handling of data.

## License Verification Data

The license server remains the authoritative source for authorization status. When requesting or checking a license, the extension may send or exchange the following information with the license server:

* A randomly generated installation identifier (Install ID)
* Product identifier (Product ID)
* Google account identifier (`google_sub`), when available
* Google email address, when available
* License-request, license-status, expiration, and related authorization information

This information is used only for license identification, license management, and prevention of unauthorized use. Scanned YCUT website content is not included in license-verification requests.

License requests, license records, authorization status, identifiers, account details supplied for licensing, timestamps, expiration dates, and administrator notes may be stored in the license service's Cloudflare D1 database for the license lifecycle and related administration. License requests and license-administration records may also be shown to authorized administrators through the project's Telegram-based approval and management workflow. Telegram receives only the licensing information needed for that administrative workflow; scanned YCUT website content is not sent to Telegram.

## Google Identity Information

When the required Chrome permissions are granted and the browser provides account information, the extension may obtain the user's Google account identifier and email address through the Chrome Identity API.

Google Identity information is used only to identify and manage licensing. It is not used for advertising, behavioral tracking, profiling, or unrelated analytics.

## Authorization QR Codes

Authorization QR Codes are generated locally inside the extension from the approval URL supplied by the license workflow. The approval URL is not sent to a third-party QR Code generation service.

Scanning the QR Code opens the encoded approval destination as part of the existing authorization workflow.

## Local Storage

The extension uses Chrome local storage for operational information such as the Install ID, cached license status and expiration information, Google account information used for licensing, and the user's acknowledgement of required notices. Existing local identifiers are reused so extension updates do not intentionally create a new Install ID.

## Data Use and Sharing

The extension does not sell user data. License-related information is not used for advertising, behavioral tracking, or unrelated analytics, and YCUT scanning content is not provided to the license server.

The license service is hosted on Cloudflare infrastructure. Like other hosted network services, Cloudflare may process routine request metadata, such as network and security information, under its own service practices. The license Worker does not intentionally read or write IP addresses, user-agent strings, device fingerprints, or location data into its D1 licensing tables.

## Changes to This Privacy Policy

This Privacy Policy may be updated when the extension's functionality, permissions, or data flows change. Users should review the latest version when installing or updating the extension.

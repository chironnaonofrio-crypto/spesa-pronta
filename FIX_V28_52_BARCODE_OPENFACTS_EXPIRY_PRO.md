# V28.52 Barcode + Open Facts + Scadenza PRO

- Product/auto OpenAI kept low-cost (~240 token default).
- Label/ingredients step routes to Open Facts family when barcode/name/brand is available, avoiding another OpenAI spend.
- Expiry step adds stricter internal date parser and UI button to skip expiry.
- Barcode step uses browser BarcodeDetector when available, validates GTIN checksum, then checks Open Food Facts / Open Products Facts / Open Beauty Facts / Open Pet Food Facts before OpenAI.
- Invalid barcode numbers are rejected instead of saved.

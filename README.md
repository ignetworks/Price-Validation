# VOC Alert

CLI tool that queries NetSuite for vendor bills and flags VOC line price variances by comparing MRC rates.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your NetSuite TBA credentials
```

### NetSuite Credentials

This tool uses **Token-Based Authentication (TBA)** with OAuth 1.0. You need 5 values:

```
NS_ACCOUNT_ID=5192615          # Your NetSuite account ID
NS_CONSUMER_KEY=               # From Integration Record in NetSuite
NS_CONSUMER_SECRET=            # From Integration Record in NetSuite
NS_TOKEN_ID=                   # From Access Token in NetSuite
NS_TOKEN_SECRET=               # From Access Token in NetSuite
```

**How to get credentials:**
1. **Consumer Key/Secret** — Setup > Integration > Manage Integrations > New. Enable Token-Based Authentication. Save to get the key and secret.
2. **Token ID/Secret** — Setup > Users/Roles > Access Tokens > New. Select the integration and role. Save to get the token ID and secret.

## Usage

### Poll Mode

Runs continuously, checking for new vendor bills at a regular interval.

```bash
node index.js poll                  # polls every 30 minutes (default)
node index.js poll --interval 15    # polls every 15 minutes
```

### Query Mode

One-shot analysis for a specific date or date range.

```bash
node index.js query --today                              # today's bills
node index.js query --date 2026-02-02                    # specific date
node index.js query --from 2026-02-01 --to 2026-02-07   # date range
node index.js query --today --export                     # export results to JSON
```

### Flags

| Flag | Mode | Description |
|------|------|-------------|
| `--interval <min>` | poll | Minutes between poll cycles (default: 30) |
| `--date <YYYY-MM-DD>` | query | Analyze a specific date |
| `--from / --to` | query | Date range |
| `--today` | query | Shorthand for today's date |
| `--export` | query | Save results to `voc-analysis-{date}.json` |

## Demo Mode

If `NS_ACCOUNT_ID` is not set in `.env`, the tool runs in demo mode with realistic mock data. No NetSuite connection is needed.

## How It Works

1. Fetches vendor bills for the target date(s) from NetSuite REST API
2. For each bill, fetches the VOC line items (voclines)
3. For each vocline, looks up the most recent prior rate for the same item
4. Calculates the percentage variance between current and prior rates
5. Classifies each vocline based on variance thresholds

### Variance Classification

| Status | Condition |
|--------|-----------|
| **MATCH** | Rate variance < 0.5% |
| **WARNING** | Rate variance between 0.5% and 3% |
| **MISMATCH** | Rate variance greater than 3% |
| **NEW ITEM** | No prior rate found for this item |

## Cache

In poll mode, processed bill IDs are stored in `.voc-cache.json` to avoid re-alerting. The cache is capped at 10,000 entries. Delete the file to reset.

## npm Scripts

```bash
npm start       # node index.js (shows help)
npm run poll    # node index.js poll
npm run query   # node index.js query --today
```

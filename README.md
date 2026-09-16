# Cutoff Atlas

A static, GitHub Pages-ready explorer for NEET-PG counselling allotment lists. It supports any number of rounds without changing the interface code.

Students can search institutions, courses, states, quotas, and categories; filter by round and closing-rank range; compare round-wise opening/closing ranks in newest-to-oldest order; and inspect the exact ranks behind each range.

## Run locally

From the project folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish on GitHub Pages

1. Create a GitHub repository and upload this folder's contents.
2. Open **Settings → Pages** in the repository.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)`, then save.

The site has no server-side dependencies or build step.

## Refresh the dataset

The extractor accepts either the original PDF or text produced by `pdftotext -layout`:

```bash
python3 scripts/extract_data.py path/to/round-2.pdf data/2025-round-2.json
```

Then add the round to `data/index.json`:

```json
{
  "id": "2025-round-2",
  "label": "Round 2",
  "shortLabel": "R2",
  "order": 2,
  "file": "./data/2025-round-2.json"
}
```

Use a higher `order` for later rounds. The site automatically loads every listed dataset, places the newest round first, adds it to the round filter, and stacks each program's round-wise ranges from newest to oldest. This also works for named stages such as a stray-vacancy round; the display order is controlled by `order`, not by a fixed round count.

The current Round 1 dataset contains 26,854 parsed allotments grouped into 14,586 searchable ranges. Thirty-five unusually wrapped rows in the 26,889-row source could not be safely reconstructed from the PDF text layer and are intentionally omitted rather than guessed.

## Data interpretation

- Opening and closing ranks are the lowest and highest observed ranks for the same institution, course, quota, and allotted-seat category.
- The counts represent allotments in this result list, not an independently verified seat matrix.
- State is extracted from the institution/address field and should be treated as a convenience filter.
- Always verify decisions against the official MCC counselling documents.

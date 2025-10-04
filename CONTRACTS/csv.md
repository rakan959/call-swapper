# CSV Contract (Public Google Sheets Export)

The site fetches a public CSV formed by Google Sheets’ `export?format=csv` URL.

## Columns (required)

- Shift ID (string, unique)
- Resident (string display name; must map to a Resident by name)
- Resident ID (string stable id; preferred if available)
- Start (ISO 8601 or parseable local datetime)
- End (ISO 8601 or parseable local datetime)
- Type (e.g., MOSES|WEILER|IP CONSULT|NIGHT FLOAT|BACKUP)
- Location (optional)

If only names are present, a deterministic ID is derived as `hash(name + start + type)`.

## Mapping rules

- Strip whitespace, normalize smart quotes.
- If both Resident and Resident ID present, Resident ID wins.
- Times parse with Day.js; if missing zone, assume browser zone.
- Validate per JSON Schemas; collect row-level errors with row indices.

## Example rows

```
Shift ID,Resident,Resident ID,Start,End,Type,Location
S001,A. Adams,R01,2025-10-03T08:00:00-04:00,2025-10-03T20:00:00-04:00,MOSES,Main
S002,B. Baker,R02,2025-10-03T20:00:00-04:00,2025-10-04T08:00:00-04:00,NIGHT FLOAT,Main
```

## Negative cases

- End <= Start → invalid (F-007).
- Unknown resident (name/id not in roster) → invalid, or auto-register if `--allowUnknownResidents` flag is enabled (off by default).
- Type not in whitelist → invalid.

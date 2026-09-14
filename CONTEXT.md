# Greater Bangkok Metro Mini 3D

A web-based 3D visualization of Bangkok's rail transit network, where trains are
placed on 3D track by interpolating static GTFS timetables. This glossary holds
the project's shared vocabulary — terms whose meaning is specific to this
domain, not general programming.

## Language

### Reader language

**Primary language**:
The language a reader sees first. Chosen per browser (auto-detected once,
persisted when the reader explicitly switches) and never encoded in the URL.
_Avoid_: locale, UI language, i18n language

**Secondary language**:
The other shipped language, rendered alongside the primary one (e.g. the
smaller line under a station's primary name).
_Avoid_: fallback, subtitle

**Locale**:
Reserved for date/number formatting rules only. It is never the reader-facing
language choice.
_Avoid_: using it to mean primary language

**Basemap labels**:
Place-name text rendered by the basemap style itself, not by this app.
Deliberately excluded from primary-language scope.
_Avoid_: map labels (ambiguous with the app's own station billboards)

### Text by origin

**UI string**:
Interface text authored in this repo's components (labels, hints, notes, aria
text). Translated via the UI dictionary.
_Avoid_: copy, label

**Data name**:
A station, line, operator, or destination name that lives in the dataset with
one variant per language, not in UI code.
_Avoid_: bilingual label

### Provenance disclosure

**Disclosure note**:
A banner asserting a data-provenance limit (synthesized APM timetable,
estimated Pink run times, flat transfer allowance). A disclosure is only
delivered if it is complete in every shipped primary language; dropping it in
any shipped language counts as dropping the disclosure.
_Avoid_: disclaimer, banner

# Dashboard Design System

## 1. Character & Purpose
A quiet operations console prioritizing information density and clarity over decoration. Designed for lab administrators managing ~40 Linux workstations and NFC edge authentication. Light theme only.

## 2. Token Palette & Contrast
All text tokens exceed WCAG AA contrast (>= 4.5:1) against both `canvas` (#F6F7F6) and `surface` (#FFFFFF).

| Token | Hex | Tailwind | Role | Contrast (Canvas / Surface) |
|---|---|---|---|---|
| `canvas` | `#F6F7F6` | `bg-canvas` | Application background | — |
| `surface` | `#FFFFFF` | `bg-surface` | Panels, tables, inputs | — |
| `line` | `#DCE1DF` | `border-line` | Subtle dividers only | — |
| `control-border` | `#7B8782` | `border-control` | Input, select, checkbox borders | 3.5:1 / 3.7:1 (UI component >= 3:1) |
| `ink` | `#1B2220` | `text-ink` | Primary text and headings | 15.1:1 / 16.2:1 |
| `ink-muted` | `#5A6562` | `text-ink-muted` | Secondary text, placeholders, labels | 5.6:1 / 6.1:1 |
| `accent` | `#0E5A61` | `accent` / `bg-accent` | Primary buttons, links, focus outline, selected nav | 7.4:1 / 7.9:1 |
| `accent-hover` | `#0A474D` | `accent-hover` | Hover state for primary buttons | 9.3:1 / 10.0:1 |
| `accent-tint` | `#EAF4F4` | `bg-accent-tint` | Info notices, selected item backgrounds | — |
| `ok` / `ok-tint` | `#2F7D4F` / `#EDF6EF` | `ok`, `ok-tint` | Success notices, active status | 4.7:1 / 5.0:1 |
| `warn` / `warn-tint` | `#85520C` / `#FFF4DF` | `warn`, `warn-tint` | Warning notices, offline status | 6.1:1 / 6.5:1 |
| `danger` / `danger-tint` | `#B3362B` / `#FCEEEB` | `danger`, `danger-tint` | Error notices, destructive actions | 5.6:1 / 6.0:1 |

## 3. Typography
- **Font family**: Single font family `Be Vietnam Pro` (`font-sans`), bundled locally. System monospace stack (`font-mono`) for identifiers.
- **Scale**: Strict 20 / 16 / 14 / 12 px scale:
  - 20 px (`text-xl`, 600 weight): Page headers.
  - 16 px (`text-base`, 500-600 weight): Section headers, modal titles.
  - 14 px (`text-sm`, 400-500 weight): Default body, form inputs, table content.
  - 12 px (`text-xs`, 500 weight): Secondary metadata, table headers, status pills only.
- **Numbers & Case**: Sentence case for headers and labels. Tabular numbers (`tabular-nums`) enabled on all tables and metrics.
- **Monospace Identifiers**: Monospace is reserved strictly for identifiers: MAC address, machine ID, MQTT identity, raw JSON, and card UID formatted in byte groups (e.g. `04 A3 2B …`, shown only after explicit reveal).

## 4. Spacing & Layout
- Strict 4 px grid (multiples of 4 px: 4, 8, 12, 16, 20, 24, 32 px).
- Page container padding: 24 px (`p-6`).
- Gap-based flex and grid layouts.
- Radius: default 4 px (`rounded`), dialogs 6 px (`rounded-dialog`).

## 5. State & Signals
- **Status Pills**: Pills must always carry text (never colour alone).
- **Independent Signals**: Connectivity (online/offline), readiness (whether the machine will accept a card login now), session (who is logged in) and sync state remain distinct indicators.
- **Consistency**: Reuse the workstation login screen wording for system states.

## 6. Shared Components
- `Button`: Primary, secondary (default), danger, quiet. 32 px (md) or 28 px (sm). Displays `Đang xử lý…` when loading.
- `StatusPill`: Compact colored indicator with tone (`ok`, `warn`, `danger`, `info`, `neutral`). Always has text.
- `PageHeader`: Standardized page title (20 px / 600) with optional single-line description and action buttons.
- `Field`: Accessible form field with label, optional hint, error with `role="alert"`, and exported `inputClass`/`selectClass`.
- `Notice`: Inline callout banner with 3 px left accent border and status/alert ARIA role.
- `DataTable`: Accessible tabular display primitives (`Table`, `THead`, `TH`, `TR`, `TD`, `EmptyRow`) with sticky headers and tabular numerals.
- `Dialog`: Accessible modal dialog with focus trapping, focus restoration, overlay, and Escape handler.
- `ConfirmDialog`: Two-step modal for destructive actions. In-flight double-click guard and inline error display.
- `EmptyState`: Clean placeholder with title, description, and action button. No illustrations.

## 7. Confirmation Rules
- Every destructive or irreversible action requires `ConfirmDialog`.
- Dialog message must explicitly name the target object and state the consequence.
- Disabling a workstation requires typing its exact MQTT identity (`requireText`).

## 8. Strictly Forbidden ("Do Not")
- NO gradients or glowing effects.
- NO purple or dark themes.
- NO emoji icons.
- NO elevation shadows except for dialogs and popovers.
- NO hover lift animations or transforms.
- NO all-caps letter-spaced labels.
- NO directional arrows (e.g. "→") inside button text.

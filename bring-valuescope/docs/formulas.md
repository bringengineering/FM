# Formulas — BRING ValueScope Financial Underwriting Core

Every number the engine produces comes from one of the formulas below. All math
is `Decimal`; currency amounts settle to the whole 원 (`ROUND_HALF_UP`) only for
display. Engine version: see `valuescope.ENGINE_VERSION`.

## Rental income → NOI

```
GPR (Gross Potential Rent, annual) = Σ(unit monthly_rent) × 12
Vacancy Loss                       = GPR × vacancy_rate
EGI (Effective Gross Income)       = GPR − Vacancy Loss − Credit Loss + Other Income
OPEX                               = Σ(operating expense lines)
NOI (Net Operating Income)         = EGI − OPEX
Stabilized NOI                     = EGI(using stabilized_vacancy_rate) − OPEX
```

NOI **excludes** debt service, depreciation, and income tax. Tenant deposits are
**not** income.

## Debt service (three Korean conventions)

Monthly rate `i = annual_rate / 12`.

- **원리금균등 (equal payment):** `PMT = P · i·(1+i)^n / ((1+i)^n − 1)`
- **원금균등 (equal principal):** principal component `= P / n`; interest each
  month `= balance · i`.
- **만기일시 (interest-only):** each month `= P · i`; principal is a balloon at
  maturity.
- **거치 (grace):** interest-only for `grace` months, then amortize the balance
  over the remaining term.

## Sources & Uses

```
Total Uses      = purchase_price + acquisition_costs + capex + contingency
                  + financing_costs + working_capital
Required Equity = Total Uses − loan − assumed_deposits − grants
Real Leverage   = (loan + assumed_deposits) / asset_value
```

Assumed deposits reduce the cash needed at closing but are a **return
obligation**, so they re-enter as debt in Real Leverage.

## Core ratios

```
Cap Rate             = NOI / asset_price
LTV                  = loan / collateral_value
LTC                  = loan / total_project_cost
DSCR                 = NOI / annual_debt_service
Debt Yield           = NOI / loan
Cash-on-Cash         = (NOI − annual_debt_service) / required_equity
Break-even Occupancy = (OPEX + annual_debt_service − other_income) / GPR
```

Ratios with a zero denominator are reported as `null` (undefined), not `0`.

## Multi-year cash flow & exit

For hold year `y = 1..N`:

```
GPR_y  = GPR₁ · (1 + rent_growth)^(y−1)
EGI_y  = GPR_y · (1 − vacancy) · revenue_factor_y − credit_loss + other_income
OPEX_y = OPEX₁ · (1 + opex_growth)^(y−1)
NOI_y  = EGI_y − OPEX_y
CF_y   = NOI_y − debt_service_y      (levered, pre-tax)
```

`revenue_factor_y` is `1` except in year 1, where construction/lease-up lost
months reduce it to `(12 − revenue_loss_months) / 12`.

Exit at year N uses a **forward** (year N+1) stabilized NOI:

```
Exit Value          = NOI_{N+1} / exit_cap_rate
Net Sale Proceeds   = Exit Value − (Exit Value · selling_cost_rate) − loan_balance_N
Equity Cash Flows   = [ −required_equity, CF₁, …, CF_{N−1}, CF_N + Net Sale ]
IRR                 = rate r where NPV(r, equity_cash_flows) = 0   (bisection)
NPV                 = NPV(discount_rate, equity_cash_flows)
Equity Multiple     = Σ inflows / Σ |outflows|
```

## Maximum purchase price (절대 상한가 / walk-away)

The highest price at which **every** hurdle still holds:

```
maximize price
subject to  IRR ≥ target_irr
            DSCR ≥ min_dscr
            Cash-on-Cash ≥ min_cash_on_cash
            (Real Leverage ≤ max_real_leverage — a floor on price, never a cap)
```

IRR, DSCR and Cash-on-Cash fall monotonically as price rises, so the ceiling is
found by **bisection** on price to a 100,000원 tolerance.

## Decision

`GO / CONDITIONAL_GO / REVIEW / NO_GO`. Hard stops force `NO_GO` and **cannot**
be offset by strong returns:

- downside DSCR < `min_downside_dscr` (default 1.0)
- base DSCR < 1.0
- deal only works if refinancing succeeds (`refinance_dependent`)

Missing rights data (deposits / senior liens) forces `REVIEW`. Otherwise: `GO`
when the base case clears all hurdles and asking ≤ walk-away; else
`CONDITIONAL_GO` with the specific conditions listed.

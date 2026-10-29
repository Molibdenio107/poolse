"""Poolse pricing Monte Carlo — 29-10-2026. python3 docs/research/pricing-sim-2026-10-29.py
Assumptions (all `assumed`, no history yet — docs/financials.md §7): pilot comped 10–14 months,
2nd club in month 3–12, 3rd club with 50% chance 6–18 months later (20% churn after a year),
running costs €7–17 with no payer, €80–100 once one pays, +€5–15 per club beyond two,
Stripe ~1.5% + €0.25 per payment. Seeded."""
import numpy as np
rng=np.random.default_rng(1); N=20000; M=36
def run(found, list_price, addon, p_addon):
    cum=np.zeros((N,M))
    for i in range(N):
        pilot_free=rng.integers(10,15); c2=rng.integers(3,13)
        c3=c2+rng.integers(6,19) if rng.random()<0.5 else 999
        churn3=rng.random()<0.2; bal=0
        for m in range(M):
            rev=0; paying=0
            if m>=pilot_free: rev+=found if m<pilot_free+12 else list_price; paying+=1
            if m>=c2: rev+=found if m<c2+12 else list_price; paying+=1
            if m>=c3 and not (churn3 and m>c3+12): rev+=list_price; paying+=1
            rev+=paying*p_addon*addon
            cost=rng.uniform(7,17) if paying==0 else rng.uniform(80,100)+(paying-2)*rng.uniform(5,15)*(paying>2)
            cost+=0.015*rev+0.25*paying
            bal+=rev-cost; cum[i,m]=bal
    return cum
SCEN={"v1: €49 founding / €99 list, no add-ons":(49,99,0,0),
      "€69 founding / €99 list, no add-ons":(69,99,0,0),
      "€49/€99 + add-on €29 (40% take)":(49,99,29,0.4),
      "v2: €69/€99 + add-on €29 (40% take)":(69,99,29,0.4)}
for name,a in SCEN.items():
    c=run(*a)
    print(f"{name}\n  P(cum>=0 @m24)={np.mean(c[:,23]>=0):.0%}  @m36={np.mean(c[:,35]>=0):.0%}  "
          f"median cum m24=€{np.median(c[:,23]):.0f}  p10=€{np.percentile(c[:,23],10):.0f}  median trough=€{np.median(c.min(1)):.0f}")

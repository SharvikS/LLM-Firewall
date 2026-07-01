package billing

import (
	"context"
	"testing"
	"time"
)

func TestPlanForUnknownTierFailsSafe(t *testing.T) {
	if PlanFor("bogus").Tier != "free" {
		t.Fatal("unknown tier must default to the most restrictive (free) plan")
	}
	if PlanFor("enterprise").MonthlyRequests != 0 {
		t.Fatal("enterprise should be unlimited (0)")
	}
}

func TestNilMeterIsSafe(t *testing.T) {
	var m *Meter
	m.Record(context.Background(), "t1", 100, true, time.Now()) // must not panic
	over, u := m.OverQuota(context.Background(), "t1", "free", time.Now())
	if over {
		t.Fatal("nil meter must fail open (not over quota)")
	}
	if u.Limit != 10_000 {
		t.Fatalf("expected free limit 10000, got %d", u.Limit)
	}
}

func TestValidTier(t *testing.T) {
	if !ValidTier("pro") || ValidTier("platinum") {
		t.Fatal("ValidTier wrong")
	}
}

func TestPublicPlanPrices(t *testing.T) {
	if PlanFor("free").PriceUSD != 0 {
		t.Fatalf("expected free price 0, got %.2f", PlanFor("free").PriceUSD)
	}
	if PlanFor("starter").PriceUSD != 9.99 {
		t.Fatalf("expected starter price 9.99, got %.2f", PlanFor("starter").PriceUSD)
	}
	if PlanFor("pro").PriceUSD != 35 {
		t.Fatalf("expected pro price 35, got %.2f", PlanFor("pro").PriceUSD)
	}
}

func TestPlansOrdered(t *testing.T) {
	p := Plans()
	if len(p) != 4 || p[0].Tier != "free" || p[3].Tier != "enterprise" {
		t.Fatalf("unexpected plan order: %+v", p)
	}
}

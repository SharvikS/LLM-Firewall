package store

import (
	"context"
	"testing"
)

// These exercise the repeat-offender flagging state machine end-to-end against a
// real DB. They skip when titan_test is unavailable (same as the other store
// integration tests).

func resetDLP(t *testing.T, st *Store) {
	t.Helper()
	_, _ = st.Pool().Exec(context.Background(),
		`TRUNCATE dlp_violations, dlp_flags RESTART IDENTITY`)
}

func TestRecordDLPViolationRaisesFlagPastThreshold(t *testing.T) {
	st := openTestStore(t)
	resetDLP(t, st)
	ctx := context.Background()

	v := DLPViolation{Subject: "inst-abc", Account: "leaky@corp.com", Site: "chatgpt",
		Action: "BROWSER_DLP_BLOCK", Risk: 60, Reason: "PII: EMAIL_ADDRESS"}

	// threshold=3 → flagged on the 4th violation, not before.
	for i := 1; i <= 3; i++ {
		out, err := st.RecordDLPViolation(ctx, v, 3)
		if err != nil {
			t.Fatalf("violation %d: %v", i, err)
		}
		if out.ViolationCount != i {
			t.Fatalf("violation %d: count=%d want %d", i, out.ViolationCount, i)
		}
		if out.Flagged || out.NewlyFlagged {
			t.Fatalf("violation %d: flagged too early (%+v)", i, out)
		}
	}

	out, err := st.RecordDLPViolation(ctx, v, 3)
	if err != nil {
		t.Fatalf("violation 4: %v", err)
	}
	if !out.Flagged || !out.NewlyFlagged {
		t.Fatalf("violation 4 should raise a flag, got %+v", out)
	}
	if out.Flag == nil || out.Flag.Account != "leaky@corp.com" || out.Flag.ViolationCount != 4 {
		t.Fatalf("flag fields wrong: %+v", out.Flag)
	}

	// A 5th violation keeps the flag open but is NOT "newly" flagged (no second alert).
	out, err = st.RecordDLPViolation(ctx, v, 3)
	if err != nil {
		t.Fatalf("violation 5: %v", err)
	}
	if out.NewlyFlagged {
		t.Fatalf("violation 5 should not re-raise (already open)")
	}
	if !out.Flagged {
		t.Fatalf("violation 5 should still be flagged")
	}

	// Summary + listing reflect the open flag.
	sum, err := st.DLPSummary(ctx)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if sum.OpenFlags != 1 || sum.TotalViolations != 5 {
		t.Fatalf("summary wrong: %+v", sum)
	}

	flags, err := st.ListDLPFlags(ctx, "open", 50)
	if err != nil || len(flags) != 1 {
		t.Fatalf("ListDLPFlags open: %v / %d", err, len(flags))
	}

	// Acknowledge → no longer open; re-ack is a no-op.
	ok, err := st.AckDLPFlag(ctx, flags[0].ID, "admin@titan.local")
	if err != nil || !ok {
		t.Fatalf("ack: %v ok=%v", err, ok)
	}
	if again, _ := st.AckDLPFlag(ctx, flags[0].ID, "admin@titan.local"); again {
		t.Fatalf("second ack should be a no-op")
	}
	open, _ := st.CountOpenDLPFlags(ctx)
	if open != 0 {
		t.Fatalf("open flags after ack = %d want 0", open)
	}

	// A fresh violation after ack re-opens the flag (newly flagged again).
	out, err = st.RecordDLPViolation(ctx, v, 3)
	if err != nil {
		t.Fatalf("post-ack violation: %v", err)
	}
	if !out.NewlyFlagged {
		t.Fatalf("post-ack violation should re-open the flag")
	}
}

func TestRecordDLPViolationRequiresSubject(t *testing.T) {
	st := openTestStore(t)
	resetDLP(t, st)
	if _, err := st.RecordDLPViolation(context.Background(), DLPViolation{Action: "X"}, 3); err == nil {
		t.Fatal("expected error for empty subject")
	}
}

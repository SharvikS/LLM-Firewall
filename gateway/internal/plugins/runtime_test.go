package plugins

import (
	"context"
	"testing"
	"time"
)

// The repo ships a prebuilt sample plugin at gateway/plugins/. These tests run
// it through the real wazero runtime to exercise the full ABI.
const sampleDir = "../../plugins"

func TestDisabledWhenNoDir(t *testing.T) {
	rt, err := Load(context.Background(), "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if rt.Enabled() {
		t.Fatal("empty dir must yield a disabled runtime")
	}
	if got := rt.Scan(context.Background(), "anything"); got != nil {
		t.Fatalf("disabled Scan should return nil, got %v", got)
	}
}

func TestLoadAndScanSamplePlugin(t *testing.T) {
	ctx := context.Background()
	rt, err := Load(ctx, sampleDir, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close(ctx)
	if !rt.Enabled() {
		t.Skip("no sample .wasm present (run internal/plugins/sample/build.sh)")
	}

	t.Run("blocks codename", func(t *testing.T) {
		vs := rt.Scan(ctx, "Please summarize the latest on Project Zeus for the board.")
		blocked := false
		for _, v := range vs {
			if v.Block {
				blocked = true
				if v.Plugin == "" {
					t.Error("verdict missing plugin name")
				}
			}
		}
		if !blocked {
			t.Fatalf("expected a block verdict, got %+v", vs)
		}
	})

	t.Run("allows benign", func(t *testing.T) {
		for _, v := range rt.Scan(ctx, "What is the weather in Paris today?") {
			if v.Block {
				t.Fatalf("benign prompt should not be blocked: %+v", v)
			}
		}
	})

	t.Run("concurrent scans are safe", func(t *testing.T) {
		done := make(chan struct{})
		for i := 0; i < 16; i++ {
			go func() {
				defer func() { done <- struct{}{} }()
				rt.Scan(ctx, "launchcode is the secret")
				rt.Scan(ctx, "benign text here")
			}()
		}
		for i := 0; i < 16; i++ {
			<-done
		}
	})
}

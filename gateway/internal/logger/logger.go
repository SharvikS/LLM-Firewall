package logger

import (
	"log/slog"
	"os"
	"sync"
)

var (
	once     sync.Once
	instance *slog.Logger
)

// Get returns the process-wide JSON logger. It is initialised exactly once
// and is safe to call from multiple goroutines.
func Get() *slog.Logger {
	once.Do(func() {
		instance = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
			Level: slog.LevelInfo,
		}))
	})
	return instance
}

package postgres

import (
	"context"
	"time"
)

// contextWithShortTimeout returns a context that expires in a few seconds,
// used for fire-and-forget background updates where blocking would be wrong.
func contextWithShortTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 3*time.Second)
}

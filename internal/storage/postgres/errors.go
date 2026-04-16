package postgres

import "errors"

// Shared sentinel errors used by all stores in this package.
var (
	ErrConflict   = errors.New("conflict")
	ErrValidation = errors.New("validation")
)

package server

import (
	"encoding/json"
	"net/http"
)

// JSON writes v as JSON with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// APIError is the standard error envelope (matches OpenAPI Error schema).
type APIError struct {
	Error APIErrorInner `json:"error"`
}

type APIErrorInner struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// Error writes the standard error envelope.
func Error(w http.ResponseWriter, status int, code, msg string) {
	JSON(w, status, APIError{Error: APIErrorInner{Code: code, Message: msg}})
}

// ErrorWithDetails is Error plus a details payload.
func ErrorWithDetails(w http.ResponseWriter, status int, code, msg string, details any) {
	JSON(w, status, APIError{Error: APIErrorInner{Code: code, Message: msg, Details: details}})
}

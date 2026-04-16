package enrich

// WebVitalRating returns Google's good/needs-improvement/poor rating for a
// given metric + value. Used when the client doesn't send one.
//
// Thresholds as of Core Web Vitals 2024:
//   LCP:  good <= 2500ms, poor > 4000ms
//   INP:  good <= 200ms,  poor > 500ms
//   CLS:  good <= 0.1,    poor > 0.25
//   FCP:  good <= 1800ms, poor > 3000ms
//   TTFB: good <= 800ms,  poor > 1800ms
func WebVitalRating(metric string, value float64) string {
	g, p, ok := vitalThresholds(metric)
	if !ok {
		return ""
	}
	switch {
	case value <= g:
		return "good"
	case value <= p:
		return "needs-improvement"
	default:
		return "poor"
	}
}

func vitalThresholds(metric string) (good, poor float64, ok bool) {
	switch metric {
	case "LCP":
		return 2500, 4000, true
	case "INP":
		return 200, 500, true
	case "CLS":
		return 0.1, 0.25, true
	case "FCP":
		return 1800, 3000, true
	case "TTFB":
		return 800, 1800, true
	}
	return 0, 0, false
}

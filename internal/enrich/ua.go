package enrich

import (
	"strings"
	"sync"

	"github.com/ua-parser/uap-go/uaparser"
)

// UAInfo is the subset of UA data we persist.
type UAInfo struct {
	Browser    string
	BrowserVer string
	OS         string
	OSVer      string
	DeviceType string // desktop | mobile | tablet | bot
}

// UAParser wraps the ua-parser library. It's safe for concurrent use; we
// lazily build a single parser because NewFromBytes is relatively heavy.
type UAParser struct {
	once   sync.Once
	parser *uaparser.Parser
}

// NewUAParser returns a parser using the library's embedded regexes.
// No yaml file needed; uaparser.NewFromSaved loads the built-in rules.
func NewUAParser() *UAParser {
	return &UAParser{}
}

func (p *UAParser) get() *uaparser.Parser {
	p.once.Do(func() {
		p.parser = uaparser.NewFromSaved()
	})
	return p.parser
}

// Parse returns the UA info for a User-Agent string.
func (p *UAParser) Parse(ua string) UAInfo {
	if ua == "" {
		return UAInfo{}
	}
	cl := p.get().Parse(ua)
	info := UAInfo{
		Browser:    cl.UserAgent.Family,
		BrowserVer: cl.UserAgent.ToVersionString(),
		OS:         cl.Os.Family,
		OSVer:      cl.Os.ToVersionString(),
		DeviceType: classifyDevice(cl, ua),
	}
	return info
}

func classifyDevice(cl *uaparser.Client, ua string) string {
	// ua-parser flags many bots but not all; keep a lightweight fallback.
	if isLikelyBot(ua) {
		return "bot"
	}
	dev := strings.ToLower(cl.Device.Family)
	switch {
	case dev == "tablet" || strings.Contains(dev, "ipad"):
		return "tablet"
	case dev == "mobile" || strings.Contains(dev, "iphone") || strings.Contains(dev, "android"):
		// uap's Device.Family often equals "iPhone" / "Android"; treat as mobile
		return "mobile"
	case dev == "other" || dev == "":
		// No device match often means desktop.
		return "desktop"
	default:
		return "mobile"
	}
}

var botKeywords = []string{
	"bot", "crawler", "spider", "curl/", "wget/", "python-requests", "headlesschrome",
	"googlebot", "bingbot", "yandex", "baidu", "facebookexternalhit", "slackbot",
	"discordbot", "twitterbot", "linkedinbot", "pingdom", "uptime", "ahrefsbot",
	"semrushbot", "monitoring",
}

func isLikelyBot(ua string) bool {
	l := strings.ToLower(ua)
	for _, k := range botKeywords {
		if strings.Contains(l, k) {
			return true
		}
	}
	return false
}

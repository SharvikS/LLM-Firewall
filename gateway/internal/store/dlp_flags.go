package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DLPViolation is one recorded attempt to push sensitive/risky content into a
// chat web UI, captured by the browser extension. Metadata only — never the
// prompt text or the sensitive values themselves.
type DLPViolation struct {
	ID         uuid.UUID `json:"id"`
	Subject    string    `json:"subject"`
	Account    string    `json:"account"`
	Site       string    `json:"site"`
	Action     string    `json:"action"`
	Risk       float64   `json:"risk"`
	Categories string    `json:"categories"`
	Reason     string    `json:"reason"`
	Source     string    `json:"source"`
	CreatedAt  time.Time `json:"created_at"`

	// Device + network forensics captured at the moment of the violation.
	ClientIP    string `json:"client_ip"`
	UserAgent   string `json:"user_agent"`
	DeviceLabel string `json:"device_label"` // derived: "macOS · Chrome · MacIntel"
	DeviceName  string `json:"device_name"`  // MDM-provisioned real device name, if any
	DeviceID    string `json:"device_id"`    // MDM-provisioned device id, if any
	Timezone    string `json:"timezone"`
	Languages   string `json:"languages"`
	Screen      string `json:"screen"`
	DeviceJSON  string `json:"device_json"` // full raw fingerprint blob
}

// DLPFlag is a repeat-offender marker raised once a subject crosses the
// violation threshold. It surfaces on the admin portal until acknowledged.
type DLPFlag struct {
	ID             uuid.UUID  `json:"id"`
	Subject        string     `json:"subject"`
	Account        string     `json:"account"`
	ViolationCount int        `json:"violation_count"`
	MaxRisk        float64    `json:"max_risk"`
	LastSite       string     `json:"last_site"`
	LastReason     string     `json:"last_reason"`
	Status         string     `json:"status"`
	FirstFlagged   time.Time  `json:"first_flagged"`
	LastViolation  time.Time  `json:"last_violation"`
	AcknowledgedAt *time.Time `json:"acknowledged_at,omitempty"`
	AcknowledgedBy string     `json:"acknowledged_by,omitempty"`
	LastIP         string     `json:"last_ip"`
	LastDevice     string     `json:"last_device"`
}

// dlpViolationCols is the canonical column list for SELECTing a DLPViolation, so
// every read path stays in sync with scanViolation.
const dlpViolationCols = `id, subject, account, site, action, risk, categories, reason, source, created_at,
	client_ip, user_agent, device_label, device_name, device_id, timezone, languages, screen, device_json`

// rowScanner is satisfied by both pgx.Row and pgx.Rows.
type rowScanner interface{ Scan(dest ...any) error }

func scanViolation(r rowScanner) (DLPViolation, error) {
	var v DLPViolation
	err := r.Scan(&v.ID, &v.Subject, &v.Account, &v.Site, &v.Action, &v.Risk,
		&v.Categories, &v.Reason, &v.Source, &v.CreatedAt,
		&v.ClientIP, &v.UserAgent, &v.DeviceLabel, &v.DeviceName, &v.DeviceID,
		&v.Timezone, &v.Languages, &v.Screen, &v.DeviceJSON)
	return v, err
}

// FlagOutcome reports what RecordDLPViolation did, so the caller can alert on a
// freshly-raised flag without re-querying.
type FlagOutcome struct {
	ViolationCount int  // total violations for this subject (all time)
	Flagged        bool // subject is currently flagged (open)
	NewlyFlagged   bool // this violation crossed the threshold for the first time
	Flag           *DLPFlag
}

// RecordDLPViolation inserts a violation and, atomically in the same
// transaction, raises or bumps the subject's flag when the threshold is crossed.
// threshold is the number of violations that triggers a flag (e.g. >3 means
// threshold=3: the 4th violation raises it). Subject must be non-empty.
//
// The whole thing runs in one transaction so the count, the flag upsert, and the
// "newly flagged" decision can never race with a concurrent violation from the
// same subject.
func (s *Store) RecordDLPViolation(ctx context.Context, v DLPViolation, threshold int) (*FlagOutcome, error) {
	if v.Subject == "" {
		return nil, errors.New("store: DLP violation requires a subject")
	}
	if threshold < 1 {
		threshold = 3
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck — no-op after Commit

	if _, err := tx.Exec(ctx, `
		INSERT INTO dlp_violations(subject, account, site, action, risk, categories, reason, source,
		                           client_ip, user_agent, device_label, device_name, device_id,
		                           timezone, languages, screen, device_json)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		v.Subject, v.Account, v.Site, v.Action, v.Risk, v.Categories, v.Reason, v.Source,
		v.ClientIP, v.UserAgent, v.DeviceLabel, v.DeviceName, v.DeviceID,
		v.Timezone, v.Languages, v.Screen, v.DeviceJSON,
	); err != nil {
		return nil, err
	}

	// A readable "where" for the flag: real device name if MDM-provisioned, else
	// the derived label, annotated with the IP.
	lastDevice := v.DeviceName
	if lastDevice == "" {
		lastDevice = v.DeviceLabel
	}

	var count int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM dlp_violations WHERE subject=$1`, v.Subject,
	).Scan(&count); err != nil {
		return nil, err
	}

	out := &FlagOutcome{ViolationCount: count}

	// Was there already an open flag before this violation?
	var existing int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM dlp_flags WHERE subject=$1 AND status='open'`, v.Subject,
	).Scan(&existing); err != nil {
		return nil, err
	}

	if count > threshold {
		// Upsert the flag. A row may already exist (acknowledged earlier) — in
		// that case a fresh spree re-opens it. Account/site/reason track the most
		// recent violation; max_risk is monotonic.
		var flag DLPFlag
		err := tx.QueryRow(ctx, `
			INSERT INTO dlp_flags(subject, account, violation_count, max_risk, last_site, last_reason,
			                      status, first_flagged, last_violation, last_ip, last_device)
			VALUES($1,$2,$3,$4,$5,$6,'open',now(),now(),$7,$8)
			ON CONFLICT (subject) DO UPDATE SET
			    account         = EXCLUDED.account,
			    violation_count = $3,
			    max_risk        = GREATEST(dlp_flags.max_risk, EXCLUDED.max_risk),
			    last_site       = EXCLUDED.last_site,
			    last_reason     = EXCLUDED.last_reason,
			    status          = 'open',
			    last_violation  = now(),
			    last_ip         = EXCLUDED.last_ip,
			    last_device     = EXCLUDED.last_device,
			    acknowledged_at = NULL,
			    acknowledged_by = ''
			RETURNING id, subject, account, violation_count, max_risk, last_site, last_reason,
			          status, first_flagged, last_violation, acknowledged_at, acknowledged_by, last_ip, last_device`,
			v.Subject, v.Account, count, v.Risk, v.Site, v.Reason, v.ClientIP, lastDevice,
		).Scan(&flag.ID, &flag.Subject, &flag.Account, &flag.ViolationCount, &flag.MaxRisk,
			&flag.LastSite, &flag.LastReason, &flag.Status, &flag.FirstFlagged, &flag.LastViolation,
			&flag.AcknowledgedAt, &flag.AcknowledgedBy, &flag.LastIP, &flag.LastDevice)
		if err != nil {
			return nil, err
		}
		out.Flag = &flag
		out.Flagged = true
		out.NewlyFlagged = existing == 0 // crossed (or re-crossed) just now
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// ListDLPFlags returns flags, optionally filtered by status ("open" |
// "acknowledged" | "" for all), most recent violation first.
func (s *Store) ListDLPFlags(ctx context.Context, status string, limit int) ([]DLPFlag, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	q := `SELECT id, subject, account, violation_count, max_risk, last_site, last_reason,
	             status, first_flagged, last_violation, acknowledged_at, acknowledged_by, last_ip, last_device
	      FROM dlp_flags`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY last_violation DESC LIMIT ` + itoa(limit)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DLPFlag{}
	for rows.Next() {
		var f DLPFlag
		if err := rows.Scan(&f.ID, &f.Subject, &f.Account, &f.ViolationCount, &f.MaxRisk,
			&f.LastSite, &f.LastReason, &f.Status, &f.FirstFlagged, &f.LastViolation,
			&f.AcknowledgedAt, &f.AcknowledgedBy, &f.LastIP, &f.LastDevice); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CountOpenDLPFlags returns the number of open (unacknowledged) flags — used for
// the portal nav badge.
func (s *Store) CountOpenDLPFlags(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM dlp_flags WHERE status='open'`).Scan(&n)
	return n, err
}

// ListDLPViolations returns the most recent violations for one subject.
func (s *Store) ListDLPViolations(ctx context.Context, subject string, limit int) ([]DLPViolation, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+dlpViolationCols+` FROM dlp_violations WHERE subject=$1 ORDER BY created_at DESC LIMIT `+itoa(limit), subject)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DLPViolation{}
	for rows.Next() {
		v, err := scanViolation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// AckDLPFlag marks a flag acknowledged by the given operator. Returns
// pgx.ErrNoRows-wrapped nil-safe behaviour: (false, nil) when no such flag.
func (s *Store) AckDLPFlag(ctx context.Context, id uuid.UUID, by string) (bool, error) {
	ct, err := s.pool.Exec(ctx, `
		UPDATE dlp_flags SET status='acknowledged', acknowledged_at=now(), acknowledged_by=$2
		WHERE id=$1 AND status='open'`, id, by)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}

// DLPSummary is the at-a-glance rollup for the portal.
type DLPSummary struct {
	OpenFlags       int     `json:"open_flags"`
	TotalFlags      int     `json:"total_flags"`
	TotalViolations int     `json:"total_violations"`
	Violations24h   int     `json:"violations_24h"`
	TopRisk         float64 `json:"top_risk"`
}

func (s *Store) DLPSummary(ctx context.Context) (*DLPSummary, error) {
	var sum DLPSummary
	err := s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM dlp_flags WHERE status='open'),
		  (SELECT count(*) FROM dlp_flags),
		  (SELECT count(*) FROM dlp_violations),
		  (SELECT count(*) FROM dlp_violations WHERE created_at > now() - INTERVAL '24 hours'),
		  (SELECT COALESCE(max(max_risk),0) FROM dlp_flags WHERE status='open')`,
	).Scan(&sum.OpenFlags, &sum.TotalFlags, &sum.TotalViolations, &sum.Violations24h, &sum.TopRisk)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return &sum, nil
}

// BrowserDLPOverview is the full monitoring rollup for the dashboard Browser tab
// — everything the extension fleet has reported, aggregated.
type BrowserDLPOverview struct {
	TotalEvents    int             `json:"total_events"`
	Blocked        int             `json:"blocked"`
	Redacted       int             `json:"redacted"`
	Overrides      int             `json:"overrides"`
	Events24h      int             `json:"events_24h"`
	ActiveInstalls int             `json:"active_installs"` // distinct subjects (devices/profiles)
	KnownAccounts  int             `json:"known_accounts"`  // distinct detected account emails
	OpenFlags      int             `json:"open_flags"`
	BySite         []CountBucket   `json:"by_site"`
	ByCategory     []CountBucket   `json:"by_category"`
	Series24h      []TimeBucket    `json:"series_24h"`
	Recent         []DLPViolation  `json:"recent"`
	TopOffenders   []OffenderCount `json:"top_offenders"`
}

type CountBucket struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}
type TimeBucket struct {
	Hour  time.Time `json:"hour"`
	Count int       `json:"count"`
}
type OffenderCount struct {
	Subject string  `json:"subject"`
	Account string  `json:"account"`
	Count   int     `json:"count"`
	MaxRisk float64 `json:"max_risk"`
}

// BrowserDLPOverview computes the whole monitoring picture from dlp_violations
// (plus the open-flag count). Browser violations are low-volume, so a handful of
// grouped queries is comfortably cheap and always current.
func (s *Store) BrowserDLPOverview(ctx context.Context) (*BrowserDLPOverview, error) {
	o := &BrowserDLPOverview{
		BySite: []CountBucket{}, ByCategory: []CountBucket{},
		Series24h: []TimeBucket{}, Recent: []DLPViolation{}, TopOffenders: []OffenderCount{},
	}

	// Totals + distinct installs/accounts + 24h, in one pass.
	if err := s.pool.QueryRow(ctx, `
		SELECT
		  count(*),
		  count(*) FILTER (WHERE action='BROWSER_DLP_BLOCK'),
		  count(*) FILTER (WHERE action='BROWSER_DLP_REDACT'),
		  count(*) FILTER (WHERE action='BROWSER_DLP_OVERRIDE'),
		  count(*) FILTER (WHERE created_at > now() - INTERVAL '24 hours'),
		  count(DISTINCT subject),
		  count(DISTINCT NULLIF(account,''))
		FROM dlp_violations`,
	).Scan(&o.TotalEvents, &o.Blocked, &o.Redacted, &o.Overrides, &o.Events24h,
		&o.ActiveInstalls, &o.KnownAccounts); err != nil {
		return nil, err
	}

	if n, err := s.CountOpenDLPFlags(ctx); err == nil {
		o.OpenFlags = n
	}

	// By site.
	if buckets, err := s.countBuckets(ctx,
		`SELECT site, count(*) FROM dlp_violations WHERE site<>'' GROUP BY site ORDER BY 2 DESC`); err == nil {
		o.BySite = buckets
	}

	// By category — categories are comma-joined per row; unnest then group.
	if buckets, err := s.countBuckets(ctx,
		`SELECT cat, count(*) FROM (
		   SELECT unnest(string_to_array(categories, ',')) AS cat FROM dlp_violations WHERE categories<>''
		 ) t WHERE cat<>'' GROUP BY cat ORDER BY 2 DESC`); err == nil {
		o.ByCategory = buckets
	}

	// 24h hourly series.
	rows, err := s.pool.Query(ctx, `
		SELECT date_trunc('hour', created_at) AS h, count(*)
		FROM dlp_violations WHERE created_at > now() - INTERVAL '24 hours'
		GROUP BY h ORDER BY h`)
	if err == nil {
		for rows.Next() {
			var b TimeBucket
			if err := rows.Scan(&b.Hour, &b.Count); err == nil {
				o.Series24h = append(o.Series24h, b)
			}
		}
		rows.Close()
	}

	// Recent events (most recent 25 across all subjects).
	rrows, err := s.pool.Query(ctx,
		`SELECT `+dlpViolationCols+` FROM dlp_violations ORDER BY created_at DESC LIMIT 25`)
	if err == nil {
		for rrows.Next() {
			if v, err := scanViolation(rrows); err == nil {
				o.Recent = append(o.Recent, v)
			}
		}
		rrows.Close()
	}

	// Top offenders by violation volume.
	orows, err := s.pool.Query(ctx, `
		SELECT subject, COALESCE(max(NULLIF(account,'')),'') , count(*), COALESCE(max(risk),0)
		FROM dlp_violations GROUP BY subject ORDER BY 3 DESC LIMIT 8`)
	if err == nil {
		for orows.Next() {
			var off OffenderCount
			if err := orows.Scan(&off.Subject, &off.Account, &off.Count, &off.MaxRisk); err == nil {
				o.TopOffenders = append(o.TopOffenders, off)
			}
		}
		orows.Close()
	}

	return o, nil
}

// countBuckets runs a "SELECT key, count" query into []CountBucket.
func (s *Store) countBuckets(ctx context.Context, q string) ([]CountBucket, error) {
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CountBucket{}
	for rows.Next() {
		var b CountBucket
		if err := rows.Scan(&b.Key, &b.Count); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// itoa is a tiny dependency-free int→string for safe LIMIT inlining (the value
// is already clamped to a small positive int, so this never reaches user input).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

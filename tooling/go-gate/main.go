// ─── SDD gates (Go — 단일 정적 바이너리, 인터프리터 0) ─────────
// CGO_ENABLED=0 으로 빌드하면 libc도 안 묶인 단일 정적 실행파일이 된다.
// GOOS/GOARCH만 바꿔 linux·darwin·windows × amd64·arm64 전부를 한 소스에서
// 크로스컴파일 → 소비자는 Go조차 필요 없이 바이너리만 받아 실행한다.
// 어떤 언어(Go·C·Rust·COBOL·…) 프로젝트든 "그 바이너리 하나"면 게이트가 돈다.
//
// 같은 sdd.config.json을 읽고 셸판/Python판/Node판과 동작 동일.
//
// Usage:
//   sdd-gate fr [--strict]
//   sdd-gate ownership [--strict]
//   sdd-gate run <stage>
package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Config struct {
	SpecDir             string            `json:"specDir"`
	ScanDirs            []string          `json:"scanDirs"`
	IgnoreDirs          []string          `json:"ignoreDirs"`
	TestFileRegex       []string          `json:"testFileRegex"`
	OwnershipCategories []string          `json:"ownershipCategories"`
	SpecIdPrefixes      []string          `json:"specIdPrefixes"`
	Commands            map[string]string `json:"commands"`

	path    string
	root    string
	tre     []*regexp.Regexp
	specID  *regexp.Regexp // (?:SPEC|TEST|…)-\d{3}  (specIdPrefixes에서 파생)
	covers  *regexp.Regexp // @covers <PREFIX>-NNN/FR-NNN
}

func defaults() Config {
	return Config{
		SpecDir:  "sdd/specs",
		ScanDirs: []string{"src", "tests"},
		IgnoreDirs: []string{
			"node_modules", ".next", "coverage", "dist", "build", "out",
			"target", "vendor", "__pycache__", ".venv", "venv", ".git",
			".idea", ".gradle", "bin", "obj", "Pods", ".dart_tool",
		},
		TestFileRegex:       []string{`\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$`},
		OwnershipCategories: []string{"Entities", "Surfaces", "Capabilities"},
		SpecIdPrefixes:      []string{"SPEC"},
		Commands:            map[string]string{},
	}
}

func findConfig(start string) string {
	d := start
	for {
		p := filepath.Join(d, "sdd.config.json")
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
		parent := filepath.Dir(d)
		if parent == d {
			return ""
		}
		d = parent
	}
}

func loadConfig() Config {
	cfg := defaults()
	cwd, _ := os.Getwd()
	path := findConfig(cwd)
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintf(os.Stderr, "✗ sdd.config.json 읽기 실패: %s\n  %v\n", path, err)
			os.Exit(1)
		}
		var user Config
		if err := json.Unmarshal(data, &user); err != nil {
			fmt.Fprintf(os.Stderr, "✗ sdd.config.json 파싱 실패: %s\n  %v\n", path, err)
			os.Exit(1)
		}
		if user.SpecDir != "" {
			cfg.SpecDir = user.SpecDir
		}
		if len(user.ScanDirs) > 0 {
			cfg.ScanDirs = user.ScanDirs
		}
		if len(user.IgnoreDirs) > 0 {
			cfg.IgnoreDirs = user.IgnoreDirs
		}
		if len(user.TestFileRegex) > 0 {
			cfg.TestFileRegex = user.TestFileRegex
		}
		if len(user.OwnershipCategories) > 0 {
			cfg.OwnershipCategories = user.OwnershipCategories
		}
		if len(user.SpecIdPrefixes) > 0 {
			cfg.SpecIdPrefixes = user.SpecIdPrefixes
		}
		if len(user.Commands) > 0 {
			cfg.Commands = user.Commands
		}
		cfg.path = path
		cfg.root = filepath.Dir(path)
	} else {
		cfg.root = cwd
	}
	for _, s := range cfg.TestFileRegex {
		cfg.tre = append(cfg.tre, regexp.MustCompile(s))
	}
	// spec ID 접두어 파생값. ["SPEC","TEST"] → "SPEC|TEST"
	reSafe := regexp.MustCompile(`[^A-Za-z0-9_]`)
	var parts []string
	for _, p := range cfg.SpecIdPrefixes {
		parts = append(parts, reSafe.ReplaceAllString(p, ""))
	}
	alt := strings.Join(parts, "|")
	cfg.specID = regexp.MustCompile(`(?:` + alt + `)-\d{3}`)
	cfg.covers = regexp.MustCompile(`@covers\s+((?:` + alt + `)-\d{3})/(FR-\d{3})`)
	return cfg
}

func (c Config) hasSpecPrefix(name string) bool {
	for _, p := range c.SpecIdPrefixes {
		if strings.HasPrefix(name, p+"-") {
			return true
		}
	}
	return false
}

func (c Config) resolve(rel string) string {
	return filepath.Join(append([]string{c.root}, strings.Split(rel, "/")...)...)
}

func (c Config) isTestFile(name string) bool {
	for _, re := range c.tre {
		if re.MatchString(name) {
			return true
		}
	}
	return false
}

func (c Config) cfgTag() string {
	if c.path == "" {
		return "defaults(JS/TS)"
	}
	return strings.TrimPrefix(c.path, c.root+string(os.PathSeparator))
}

func (c Config) walkTests(root string) []string {
	ignore := map[string]bool{}
	for _, d := range c.IgnoreDirs {
		ignore[d] = true
	}
	var out []string
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if ignore[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if c.isTestFile(d.Name()) {
			out = append(out, p)
		}
		return nil
	})
	return out
}

var (
	reFRDecl  = regexp.MustCompile(`\*\*(FR-\d{3})\*\*`) // FR만 — 접두어 무관
	reWS      = regexp.MustCompile(`\s+`)
	reOwnHdr  = regexp.MustCompile(`(?m)^##\s+Ownership`)
	reNextSec = regexp.MustCompile(`(?m)^##\s`)
	// spec ID / @covers 정규식은 cfg.specID / cfg.covers (specIdPrefixes에서 파생).
)

func gateFR(c Config, strict bool) {
	specDir := c.resolve(c.SpecDir)
	specs := map[string]map[string]bool{} // SPEC -> set(FR)
	if entries, err := os.ReadDir(specDir); err == nil {
		for _, e := range entries {
			n := e.Name()
			if e.IsDir() || !strings.HasSuffix(n, ".md") || !c.hasSpecPrefix(n) {
				continue
			}
			id := c.specID.FindString(n)
			if id == "" {
				continue
			}
			data, _ := os.ReadFile(filepath.Join(specDir, n))
			frs := map[string]bool{}
			for _, m := range reFRDecl.FindAllStringSubmatch(string(data), -1) {
				frs[m[1]] = true
			}
			specs[id] = frs
		}
	}

	covered := map[string]map[string]bool{}
	type ref struct{ file, spec, fr string }
	var bad []ref
	for _, sd := range c.ScanDirs {
		for _, f := range c.walkTests(c.resolve(sd)) {
			data, _ := os.ReadFile(f)
			for _, m := range c.covers.FindAllStringSubmatch(string(data), -1) {
				spec, fr := m[1], m[2]
				if covered[spec] == nil {
					covered[spec] = map[string]bool{}
				}
				covered[spec][fr] = true
				if specs[spec] == nil || !specs[spec][fr] {
					bad = append(bad, ref{f, spec, fr})
				}
			}
		}
	}

	var errs, warns []string
	for _, b := range bad {
		rel := strings.TrimPrefix(b.file, c.root+string(os.PathSeparator))
		errs = append(errs, fmt.Sprintf("R1 dangling @covers %s/%s in %s — no such FR in %s", b.spec, b.fr, rel, b.spec))
	}

	specIDs := make([]string, 0, len(specs))
	for s := range specs {
		specIDs = append(specIDs, s)
	}
	sort.Strings(specIDs)
	for _, s := range specIDs {
		frs := specs[s]
		cov := covered[s]
		if len(cov) == 0 {
			msg := fmt.Sprintf("%s: 0/%d FRs covered (not yet implemented)", s, len(frs))
			if strict && len(frs) > 0 {
				errs = append(errs, "R2(strict) "+msg)
			} else {
				warns = append(warns, msg)
			}
			continue
		}
		var missing []string
		for fr := range frs {
			if !cov[fr] {
				missing = append(missing, fr)
			}
		}
		if len(missing) > 0 {
			sort.Strings(missing)
			msg := fmt.Sprintf("%s: %d/%d FRs covered — missing %s", s, len(cov), len(frs), strings.Join(missing, ", "))
			if strict {
				errs = append(errs, "R2(strict) "+msg)
			} else {
				warns = append(warns, msg)
			}
		} else {
			warns = append(warns, fmt.Sprintf("%s: %d/%d FRs covered ✓", s, len(cov), len(frs)))
		}
	}

	totalFR, totalCov := 0, 0
	for _, frs := range specs {
		totalFR += len(frs)
	}
	for _, c := range covered {
		totalCov += len(c)
	}
	mode := "incremental"
	if strict {
		mode = "strict"
	}
	fmt.Printf("FR coverage gate — specs:%d FRs:%d covered:%d mode:%s config:%s\n", len(specs), totalFR, totalCov, mode, c.cfgTag())
	for _, w := range warns {
		fmt.Printf("  · %s\n", w)
	}
	if len(errs) > 0 {
		fmt.Fprintln(os.Stderr, "\nFR coverage violations:")
		for _, e := range errs {
			fmt.Fprintf(os.Stderr, "  ✗ %s\n", e)
		}
		os.Exit(1)
	}
	fmt.Println("FR coverage gate: OK")
}

func norm(s string) string {
	return strings.ToLower(reWS.ReplaceAllString(strings.TrimSpace(s), " "))
}

func parseOwnership(text string, cats []string) map[string][]string {
	loc := reOwnHdr.FindStringIndex(text)
	if loc == nil {
		return nil
	}
	body := text[loc[0]:]
	if i := strings.IndexByte(body, '\n'); i >= 0 {
		body = body[i+1:]
	}
	if nx := reNextSec.FindStringIndex(body); nx != nil {
		body = body[:nx[0]]
	}
	out := map[string][]string{}
	for _, cat := range cats {
		re := regexp.MustCompile(`(?i)-\s*\*\*` + regexp.QuoteMeta(cat) + `\*\*\s*:\s*(.+)`)
		m := re.FindStringSubmatch(body)
		var keys []string
		if m != nil {
			for _, raw := range strings.Split(m[1], ",") {
				k := norm(raw)
				if k == "" || k == "—" || k == "[…]" || strings.HasPrefix(k, "[") {
					continue
				}
				keys = append(keys, k)
			}
		}
		out[cat] = keys
	}
	return out
}

func gateOwnership(c Config, strict bool) {
	specDir := c.resolve(c.SpecDir)
	entries, err := os.ReadDir(specDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "✗ spec 디렉토리를 찾을 수 없음: %s\n", specDir)
		os.Exit(1)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
			files = append(files, filepath.Join(specDir, e.Name()))
		}
	}

	// cat -> key -> ordered distinct specs
	owners := map[string]map[string][]string{}
	for _, cat := range c.OwnershipCategories {
		owners[cat] = map[string][]string{}
	}
	var missing []string
	declared := 0
	for _, f := range files {
		data, _ := os.ReadFile(f)
		text := string(data)
		id := c.specID.FindString(text)
		if id == "" {
			id = filepath.Base(f)
		}
		own := parseOwnership(text, c.OwnershipCategories)
		if own == nil {
			missing = append(missing, id)
			continue
		}
		declared++
		for _, cat := range c.OwnershipCategories {
			for _, key := range own[cat] {
				existing := owners[cat][key]
				found := false
				for _, s := range existing {
					if s == id {
						found = true
						break
					}
				}
				if !found {
					owners[cat][key] = append(existing, id)
				}
			}
		}
	}

	fmt.Printf("Ownership 게이트: spec %d개 중 %d개가 Ownership 선언.\n", len(files), declared)
	if len(missing) > 0 {
		tag := "⚠"
		if strict {
			tag = "✗"
		}
		fmt.Printf("%s Ownership 블록 없음(%d): %s\n", tag, len(missing), strings.Join(missing, ", "))
	}

	type conflict struct{ cat, key string; specs []string }
	var conflicts []conflict
	for _, cat := range c.OwnershipCategories {
		var keys []string
		for k := range owners[cat] {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if len(owners[cat][k]) > 1 {
				conflicts = append(conflicts, conflict{cat, k, owners[cat][k]})
			}
		}
	}

	if len(conflicts) > 0 {
		fmt.Fprintf(os.Stderr, "\n✗ 중복 소유(구조적 중복) %d건:\n", len(conflicts))
		for _, c := range conflicts {
			fmt.Fprintf(os.Stderr, "  [%s] \"%s\" ← %s  → 한 spec으로 통합/개정 필요\n", c.cat, c.key, strings.Join(c.specs, " + "))
		}
		os.Exit(1)
	}
	if strict && len(missing) > 0 {
		fmt.Fprintln(os.Stderr, "\n✗ --strict: 모든 spec이 Ownership을 선언해야 함.")
		os.Exit(1)
	}
	fmt.Printf("✓ 구조적 중복 없음 — 모든 %s 키가 유일.\n", strings.Join(c.OwnershipCategories, "/"))
}

func gateRun(c Config, stage string) {
	cmd := c.Commands[stage]
	if cmd == "" {
		fmt.Printf("· sdd-run: '%s' 명령 미설정 — 건너뜀\n", stage)
		return
	}
	fmt.Printf("▶ sdd-run %s: %s\n", stage, cmd)
	sh := exec.Command("sh", "-c", cmd)
	sh.Dir = c.root
	sh.Stdout = os.Stdout
	sh.Stderr = os.Stderr
	if err := sh.Run(); err != nil {
		code := 1
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		}
		fmt.Fprintf(os.Stderr, "✗ sdd-run %s 실패 (exit %d)\n", stage, code)
		os.Exit(code)
	}
}

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: sdd-gate <fr|ownership|run> [...]")
		os.Exit(2)
	}
	strict := false
	for _, a := range args {
		if a == "--strict" {
			strict = true
		}
	}
	cfg := loadConfig()
	switch args[0] {
	case "fr":
		gateFR(cfg, strict)
	case "ownership":
		gateOwnership(cfg, strict)
	case "run":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "usage: sdd-gate run <stage>")
			os.Exit(2)
		}
		gateRun(cfg, args[1])
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand: %s\n", args[0])
		os.Exit(2)
	}
}

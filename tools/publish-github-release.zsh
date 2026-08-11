#!/bin/zsh
set -euo pipefail

# Safe GitHub publisher for Izzy's School Signal.
# Default behavior is a non-publishing dry run.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

MODE="dry-run"
MODE_SET=0
REPO_NAME="izzy-school-signal"
VISIBILITY="public"
TMP_DIR=""
OWNER=""
REPO_FULL_NAME=""
REPO_URL=""
MANIFEST_URL=""
BUNDLE_URL=""
INSTALLER_URL=""

readonly INSTALLER_REL='Izzy School Signal Installer.js'
readonly MANIFEST_REL='releases/stable/manifest.json'
readonly UPDATE_SOURCE_REL='releases/stable/update-source.example.json'
readonly UPDATES_REL='src/30-updates.js'
readonly README_REL='README.md'
readonly AGENTS_REL='AGENTS.md'
readonly BUILD_TOOL_REL='tools/build-release.mjs'
readonly VERIFY_TOOL_REL='tools/verify-release.mjs'
readonly PUBLISHER_REL='tools/publish-github-release.zsh'

usage() {
  cat <<'EOF'
Usage:
  ./tools/publish-github-release.zsh [--dry-run]
  ./tools/publish-github-release.zsh --publish
  ./tools/publish-github-release.zsh --publish --repo-name <name>
  ./tools/publish-github-release.zsh --publish --private

Options:
  --dry-run           Validate the release in a temporary copy. Makes no GitHub,
                      Git commit, push, or installed-Scriptable changes. Default.
  --publish           Run a mandatory dry run first, then publish only if it passes.
  --repo-name <name>  Override the repository name. Default: izzy-school-signal
  --private           Explicitly create/reuse a private repository. A private repo
                      cannot serve the public Scriptable raw update channel without
                      authentication, so public raw-update verification is disabled.
  -h, --help          Show this help.
EOF
}

log()  { printf '[Izzy Publish] %s\n' "$*"; }
warn() { printf '[Izzy Publish] WARNING: %s\n' "$*" >&2; }
die()  { printf '[Izzy Publish] ERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]]; then
    find "$TMP_DIR" -depth -mindepth 1 -delete 2>/dev/null || true
    rmdir "$TMP_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM HUP

need_arg() {
  [[ $# -ge 2 && -n "${2:-}" ]] || die "$1 requires a value."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      [[ "$MODE_SET" -eq 0 || "$MODE" == "dry-run" ]] || die 'Use only one of --dry-run or --publish.'
      MODE="dry-run"
      MODE_SET=1
      shift
      ;;
    --publish)
      [[ "$MODE_SET" -eq 0 || "$MODE" == "publish" ]] || die 'Use only one of --dry-run or --publish.'
      MODE="publish"
      MODE_SET=1
      shift
      ;;
    --repo-name)
      need_arg "$1" "${2:-}"
      REPO_NAME="$2"
      shift 2
      ;;
    --private)
      VISIBILITY="private"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

[[ "$REPO_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid repository name: $REPO_NAME"

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command '$1' is not installed or not on PATH."
}

require_tools() {
  log 'Checking required CLI tools...'
  require_command git
  require_command gh
  require_command node
  require_command curl
  require_command tar
  require_command mktemp
  require_command shasum

  git --version >/dev/null
  gh --version >/dev/null
  node --version >/dev/null

  if ! gh auth status >/dev/null 2>&1; then
    die "GitHub CLI is not authenticated. Run: gh auth login"
  fi

  OWNER="$(gh api user --jq .login 2>/dev/null)"
  [[ -n "$OWNER" ]] || die 'Could not determine the authenticated GitHub username with gh api user --jq .login.'
  REPO_FULL_NAME="$OWNER/$REPO_NAME"
  log "Authenticated GitHub user: $OWNER"
}

require_project_file() {
  [[ -f "$PROJECT_ROOT/$1" ]] || die "Required project file is missing: $1"
}

inspect_before_changes() {
  log "Inspecting project before any changes: $PROJECT_ROOT"

  local agents_path=""
  local probe="$PROJECT_ROOT"

  while [[ "$probe" != "/" ]]; do
    if [[ -f "$probe/$AGENTS_REL" ]]; then
      agents_path="$probe/$AGENTS_REL"
      break
    fi
    probe="$(dirname "$probe")"
  done

  if [[ -n "$agents_path" ]]; then
    log "Inspecting applicable AGENTS.md: $agents_path"
    sed -n '1,220p' "$agents_path"
  else
    log 'No applicable AGENTS.md exists. Continuing without inventing one.'
  fi

  require_project_file "$README_REL"
  require_project_file "$UPDATES_REL"
  require_project_file "$INSTALLER_REL"
  require_project_file "$MANIFEST_REL"
  require_project_file "$UPDATE_SOURCE_REL"
  require_project_file "$BUILD_TOOL_REL"
  require_project_file "$VERIFY_TOOL_REL"

  log 'Repository structure (depth <= 3, excluding .git/node_modules):'
  (
    cd "$PROJECT_ROOT"
    find . -maxdepth 3 -mindepth 1 \
      ! -path './.git' ! -path './.git/*' \
      ! -path './node_modules' ! -path './node_modules/*' \
      -print | sort | sed -n '1,220p'
  )

  log 'Inspecting release/build/update contracts...'
  node - "$PROJECT_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const files = [
  'AGENTS.md',
  'README.md',
  'tools/build-release.mjs',
  'tools/verify-release.mjs',
  'Izzy School Signal Installer.js',
  'src/30-updates.js',
  'releases/stable/manifest.json',
  'releases/stable/update-source.example.json'
];
for (const rel of files) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.log(`  ${rel}: not present`);
    continue;
  }
  const stat = fs.statSync(abs);
  const text = fs.readFileSync(abs, 'utf8');
  const replaceOwnerCount = (text.match(/REPLACE_OWNER/g) || []).length;
  console.log(`  ${rel}: ${stat.size} bytes, ${text.split(/\r?\n/).length} lines, REPLACE_OWNER=${replaceOwnerCount}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'releases/stable/manifest.json'), 'utf8'));
console.log(`  manifest keys: ${Object.keys(manifest).sort().join(', ')}`);
NODE

  log 'Initial inspection complete. No files have been changed.'
}

check_git_context_without_mutation() {
  local top=""
  if top="$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)"; then
    top="$(cd "$top" && pwd -P)"
    if [[ "$top" != "$PROJECT_ROOT" ]]; then
      die "Project is inside a different Git repository at '$top'. Refusing to reuse unrelated Git history."
    fi
    log "Existing Git repository detected at project root."
    git -C "$PROJECT_ROOT" status -sb
  else
    log 'No Git repository exists at the project root. Publish mode will initialize one only after validation passes.'
  fi
}

check_existing_remote_repo() {
  local repo_json="$TMP_DIR/repo.json"
  if gh repo view "$REPO_FULL_NAME" --json nameWithOwner,visibility,url,defaultBranchRef >"$repo_json" 2>/dev/null; then
    local remote_visibility
    remote_visibility="$(node -e 'const j=require(process.argv[1]); process.stdout.write(String(j.visibility||"").toLowerCase())' "$repo_json")"
    REPO_URL="$(node -e 'const j=require(process.argv[1]); process.stdout.write(j.url||"")' "$repo_json")"
    log "GitHub repository exists: $REPO_URL ($remote_visibility)"
    if [[ "$VISIBILITY" == "public" && "$remote_visibility" != "public" ]]; then
      die "Existing repository '$REPO_FULL_NAME' is not public. Re-run with --private only if that is intentional."
    fi
    if [[ "$VISIBILITY" == "private" && "$remote_visibility" != "private" ]]; then
      die "Existing repository '$REPO_FULL_NAME' is public. Refusing to change repository visibility automatically."
    fi
    return 0
  fi

  REPO_URL="https://github.com/$REPO_FULL_NAME"
  log "GitHub repository does not exist yet: $REPO_FULL_NAME"
  if [[ "$MODE" == "dry-run" ]]; then
    log "Dry run only: would create it as $VISIBILITY after all checks pass."
  fi
  return 1
}

copy_project_for_dry_run() {
  local destination="$1"
  mkdir -p "$destination"
  (
    cd "$PROJECT_ROOT"
    tar --exclude='./.git' --exclude='./.git/*' -cf - .
  ) | (
    cd "$destination"
    tar -xf -
  )
}

replace_owner_placeholders() {
  local root="$1"
  local owner="$2"
  log "Replacing REPLACE_OWNER placeholders with GitHub owner '$owner'..."
  ROOT="$root" OWNER_VALUE="$owner" node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.ROOT;
const owner = process.env.OWNER_VALUE;
const files = [
  'src/30-updates.js',
  'Izzy School Signal Installer.js',
  'releases/stable/manifest.json',
  'releases/stable/update-source.example.json'
];
for (const rel of files) {
  const abs = path.join(root, rel);
  const before = fs.readFileSync(abs, 'utf8');
  const after = before.replaceAll('REPLACE_OWNER', owner);
  if (before !== after) fs.writeFileSync(abs, after, 'utf8');
  const remaining = (after.match(/REPLACE_OWNER/g) || []).length;
  if (remaining) throw new Error(`${rel} still contains ${remaining} REPLACE_OWNER placeholder(s)`);
  console.log(`  ${rel}: ${before === after ? 'already configured' : 'updated'}`);
}
NODE
}

ensure_readme_docs() {
  local root="$1"
  ROOT="$root" node <<'NODE'
const fs = require('fs');
const path = require('path');
const file = path.join(process.env.ROOT, 'README.md');
let text = fs.readFileSync(file, 'utf8');
const marker = '<!-- github-release-publisher -->';
if (!text.includes(marker)) {
  const section = `

${marker}
## Publish the stable GitHub release

Run a validation-only dry run first:

\`\`\`zsh
./tools/publish-github-release.zsh --dry-run
\`\`\`

Publish to the default public repository only after the dry run passes:

\`\`\`zsh
./tools/publish-github-release.zsh --publish
\`\`\`

Use \`--repo-name <name>\` to override the repository name. \`--private\` is an explicit override, but a private repository cannot provide the unauthenticated public raw URLs required by Scriptable's stable update channel.
`;
  if (!text.endsWith('\n')) text += '\n';
  fs.writeFileSync(file, text + section, 'utf8');
  console.log('  README.md: added publisher usage section');
} else {
  console.log('  README.md: publisher usage section already present');
}
NODE
}

build_release() {
  local root="$1"
  log 'Building bundled release...'
  (cd "$root" && node tools/build-release.mjs)
}

detect_bundle_rel() {
  local root="$1"
  ROOT="$root" node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.ROOT;
const manifestPath = path.join(root, 'releases/stable/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectStrings(v, out));
  return out;
}

for (const value of collectStrings(manifest)) {
  const match = value.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\/(.+\.js)(?:\?.*)?$/i);
  if (!match) continue;
  let rel;
  try { rel = decodeURIComponent(match[1]); } catch { rel = match[1]; }
  if (/installer/i.test(rel)) continue;
  if (fs.existsSync(path.join(root, rel))) {
    process.stdout.write(rel);
    process.exit(0);
  }
}

const stableDir = path.join(root, 'releases/stable');
const candidates = fs.readdirSync(stableDir)
  .filter(name => name.endsWith('.js') && !/installer/i.test(name))
  .map(name => path.posix.join('releases/stable', name));

const preferred = candidates.filter(rel => /izzy.*school.*signal/i.test(rel));
const pool = preferred.length ? preferred : candidates;
if (pool.length !== 1) {
  console.error(`Could not uniquely identify bundled application script. Candidates: ${pool.join(', ') || '(none)'}`);
  process.exit(2);
}
process.stdout.write(pool[0]);
NODE
}

update_manifest_metadata() {
  local root="$1"
  local bundle_rel="$2"
  local published_at="$3"

  ROOT="$root" OWNER_VALUE="$OWNER" REPO_VALUE="$REPO_NAME" BUNDLE_REL="$bundle_rel" PUBLISHED_AT="$published_at" node <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.env.ROOT;
const owner = process.env.OWNER_VALUE;
const repo = process.env.REPO_VALUE;
const bundleRel = process.env.BUNDLE_REL;
const publishedAt = process.env.PUBLISHED_AT;
const manifestPath = path.join(root, 'releases/stable/manifest.json');
const bundlePath = path.join(root, bundleRel);

const bytes = fs.readFileSync(bundlePath);
const source = bytes.toString('utf8');
if (!Buffer.from(source, 'utf8').equals(bytes)) {
  throw new Error('Bundled application script is not valid exact UTF-8 text.');
}
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const sourceBytes = bytes.length;

const marker = source.indexOf('const APP_INFO = Object.freeze');
if (marker < 0) throw new Error('Could not locate top-level const APP_INFO = Object.freeze(...) in bundled script.');
const block = source.slice(marker, marker + 12000);

function stringField(name) {
  const re = new RegExp(`\\b${name}\\s*:\\s*["']([^"']+)["']`);
  const m = block.match(re);
  return m ? m[1] : null;
}
function numberField(name) {
  const re = new RegExp(`\\b${name}\\s*:\\s*(\\d+)`);
  const m = block.match(re);
  return m ? Number(m[1]) : null;
}

const appId = stringField('id') || stringField('appId');
const version = stringField('version');
const build = numberField('build');
const dataSchema = numberField('dataSchemaVersion') ?? numberField('calendarSchemaVersion') ?? numberField('schemaVersion');

if (!appId) throw new Error('Could not extract app ID from APP_INFO.');
if (!version) throw new Error('Could not extract version from APP_INFO.');
if (!Number.isInteger(build)) throw new Error('Could not extract numeric build from APP_INFO.');
if (!Number.isInteger(dataSchema)) throw new Error('Could not extract data/calendar schema version from APP_INFO.');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function findSlots(obj, aliases, trail = [], found = []) {
  if (!obj || typeof obj !== 'object') return found;
  for (const [key, value] of Object.entries(obj)) {
    const nextTrail = [...trail, key];
    if (aliases.includes(key)) found.push({ parent: obj, key, path: nextTrail.join('.') });
    if (value && typeof value === 'object') findSlots(value, aliases, nextTrail, found);
  }
  return found;
}

function setExisting(label, aliases, value) {
  const topLevel = aliases.filter(key => Object.prototype.hasOwnProperty.call(manifest, key));
  if (topLevel.length) {
    for (const key of topLevel) manifest[key] = value;
    return topLevel;
  }

  const slots = findSlots(manifest, aliases);
  if (slots.length === 0) {
    throw new Error(`Manifest has no recognized ${label} field. Expected one of: ${aliases.join(', ')}`);
  }
  if (slots.length > 1) {
    throw new Error(`Manifest ${label} field is ambiguous. Matches: ${slots.map(s => s.path).join(', ')}`);
  }
  slots[0].parent[slots[0].key] = value;
  return [slots[0].path];
}

const encodedPath = bundleRel.split('/').map(encodeURIComponent).join('/');
const rawScriptUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/main/${encodedPath}`;

const changed = {
  appId: setExisting('app ID', ['appId', 'appID', 'id'], appId),
  version: setExisting('version', ['version', 'appVersion'], version),
  build: setExisting('build', ['build', 'buildNumber'], build),
  dataSchema: setExisting('data schema', ['dataSchema', 'dataSchemaVersion', 'calendarSchemaVersion'], dataSchema),
  publishedAt: setExisting('publication timestamp', ['publishedAt', 'publicationTimestamp', 'published', 'releasedAt'], publishedAt),
  scriptUrl: setExisting('script URL', ['scriptUrl', 'scriptURL', 'downloadUrl', 'bundleUrl', 'applicationUrl'], rawScriptUrl),
  sha256: setExisting('SHA-256', ['sha256', 'sha256Hex', 'scriptSha256', 'sourceSha256'], sha256),
  sourceBytes: setExisting('source byte count', ['sourceBytes', 'sourceByteCount', 'byteCount', 'bytes'], sourceBytes)
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`  appId=${appId}`);
console.log(`  version=${version}`);
console.log(`  build=${build}`);
console.log(`  dataSchema=${dataSchema}`);
console.log(`  publishedAt=${publishedAt}`);
console.log(`  scriptUrl=${rawScriptUrl}`);
console.log(`  sha256=${sha256}`);
console.log(`  sourceBytes=${sourceBytes}`);
NODE
}

run_release_verification() {
  local root="$1"
  log 'Running release consistency check...'
  if ! (cd "$root" && node tools/build-release.mjs --check); then
    warn 'node tools/build-release.mjs --check failed.'
    return 1
  fi

  log 'Running every tools/test-*.mjs test...'
  local test_count=0
  while IFS= read -r test_file; do
    [[ -n "$test_file" ]] || continue
    test_count=$((test_count + 1))
    log "Test: $test_file"
    if ! (cd "$root" && node "$test_file"); then
      warn "Test failed: $test_file"
      return 1
    fi
  done < <(cd "$root" && find tools -maxdepth 1 -type f -name 'test-*.mjs' -print | sort)
  log "Completed $test_count tools/test-*.mjs test(s)."

  log 'Running release verifier...'
  if ! (cd "$root" && node tools/verify-release.mjs); then
    warn 'node tools/verify-release.mjs failed.'
    return 1
  fi
}

scan_for_publish_risks() {
  local root="$1"
  log 'Scanning project for files that must never be published...'
  ROOT="$root" node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.ROOT;

const forbiddenBasenames = new Set([
  '.env', '.env.local', '.env.production',
  'settings.json', 'calendar.json', 'calendar-last-valid.json',
  'bookmarks.json', 'notifications.json', 'notification-identifiers.json',
  'installation.json'
]);
const forbiddenSegments = new Set([
  'backups', 'backup', 'exports', 'export', 'diagnostics', 'diagnostic',
  'user-data', 'userdata', 'scriptable-data', 'icloud-data'
]);
const forbiddenExts = new Set(['.pem', '.p12', '.pfx', '.key']);
const risky = [];
const secretHits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(abs);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    const relParts = rel.toLowerCase().split('/');
    const inGeneratedPrivateArea = relParts.slice(0, -1).some(p => forbiddenSegments.has(p));
    const extension = path.extname(lower);
    const sourceLike = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.md'].includes(extension);
    if (
      forbiddenBasenames.has(lower) ||
      forbiddenExts.has(extension) ||
      lower.endsWith('.log') ||
      (inGeneratedPrivateArea && !sourceLike) ||
      ((lower.includes('backup') || lower.includes('export')) && ['.zip', '.tar', '.gz', '.tgz'].includes(extension)) ||
      (['.zip', '.tar', '.gz', '.tgz'].includes(extension) && !rel.startsWith('releases/stable/'))
    ) {
      risky.push(rel);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.size <= 5 * 1024 * 1024) {
      let text = '';
      try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      const patterns = [
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
        /\bghp_[A-Za-z0-9]{30,}\b/,
        /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
        /\bsk-proj-[A-Za-z0-9_-]{20,}\b/
      ];
      if (patterns.some(re => re.test(text))) secretHits.push(rel);
    }
  }
}
walk(root);

if (risky.length || secretHits.length) {
  if (risky.length) console.error(`Forbidden/private-data candidates:\n  ${risky.sort().join('\n  ')}`);
  if (secretHits.length) console.error(`Possible credential-bearing files (contents not printed):\n  ${secretHits.sort().join('\n  ')}`);
  process.exit(3);
}
console.log('  privacy scan passed');
NODE
}

check_manifest_no_placeholder() {
  local root="$1"
  if grep -q 'REPLACE_OWNER' "$root/$MANIFEST_REL"; then
    die "$MANIFEST_REL still contains REPLACE_OWNER."
  fi
}

perform_release_preparation() {
  local root="$1"
  local published_at="$2"
  local result_file="$3"
  replace_owner_placeholders "$root" "$OWNER" || return $?
  ensure_readme_docs "$root" || return $?
  build_release "$root" || return $?
  local bundle_rel
  if ! bundle_rel="$(detect_bundle_rel "$root")"; then
    warn 'Could not determine the bundled release path.'
    return 1
  fi
  [[ -n "$bundle_rel" ]] || die 'Bundled application script path could not be determined.'
  [[ -f "$root/$bundle_rel" ]] || die "Bundled application script does not exist: $bundle_rel"
  log "Bundled application script: $bundle_rel"
  update_manifest_metadata "$root" "$bundle_rel" "$published_at" || return $?
  check_manifest_no_placeholder "$root" || return $?
  scan_for_publish_risks "$root" || return $?
  run_release_verification "$root" || return $?
  printf '%s\n' "$bundle_rel" > "$result_file"
}

run_dry_run() {
  log 'Starting mandatory dry run in a temporary transactional copy...'
  local dry_root="$TMP_DIR/dry-run-project"
  copy_project_for_dry_run "$dry_root"
  local dry_timestamp
  dry_timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local result_file="$TMP_DIR/dry-run-bundle-rel.txt"
  local bundle_rel
  if ! perform_release_preparation "$dry_root" "$dry_timestamp" "$result_file"; then
    die 'Dry run failed. Nothing was published.'
  fi
  bundle_rel="$(cat "$result_file")"

  [[ -f "$dry_root/$bundle_rel" ]] || die "Dry run did not produce expected bundle: $bundle_rel"
  log "DRY RUN PASSED. Verified bundle: $bundle_rel"
  log 'Dry run made no GitHub repository, commit, push, or installed Scriptable changes.'
}

existing_git_repo() {
  local top=""
  if ! top="$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)"; then
    return 1
  fi
  top="$(cd "$top" && pwd -P)"
  [[ "$top" == "$PROJECT_ROOT" ]]
}

assert_existing_worktree_safe() {
  existing_git_repo || return 0
  local bad=0
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    local pathpart="${line:3}"
    # Handle rename output "old -> new" by checking the destination.
    if [[ "$pathpart" == *' -> '* ]]; then
      pathpart="${pathpart##* -> }"
    fi
    case "$pathpart" in
      "$PUBLISHER_REL"|"$README_REL") ;;
      *)
        printf '[Izzy Publish] Existing uncommitted change outside publisher setup: %s\n' "$pathpart" >&2
        bad=1
        ;;
    esac
  done < <(git -C "$PROJECT_ROOT" status --porcelain)
  [[ "$bad" -eq 0 ]] || die 'Commit/stash unrelated project changes before publishing so the built bundle cannot diverge from committed source.'
}

initialize_git_if_needed() {
  if existing_git_repo; then
    return 0
  fi

  if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    die 'Refusing to initialize Git because the project appears to be nested inside another worktree.'
  fi

  log 'Initializing Git repository at project root...'
  git -C "$PROJECT_ROOT" init >/dev/null
  if git -C "$PROJECT_ROOT" checkout -b main >/dev/null 2>&1; then
    :
  else
    git -C "$PROJECT_ROOT" branch -M main
  fi
}

ensure_main_branch() {
  local branch
  branch="$(git -C "$PROJECT_ROOT" branch --show-current)"
  if [[ -z "$branch" ]]; then
    git -C "$PROJECT_ROOT" checkout -b main >/dev/null
    return 0
  fi
  if [[ "$branch" != "main" ]]; then
    die "Current Git branch is '$branch'. Refusing to rewrite branch history; switch to main before publishing."
  fi
}

create_repo_if_needed() {
  if gh repo view "$REPO_FULL_NAME" --json nameWithOwner >/dev/null 2>&1; then
    return 0
  fi
  log "Creating GitHub repository '$REPO_FULL_NAME' as $VISIBILITY..."
  if [[ "$VISIBILITY" == "public" ]]; then
    gh repo create "$REPO_FULL_NAME" --public --description "Izzy's School Signal for Scriptable" >/dev/null
  else
    gh repo create "$REPO_FULL_NAME" --private --description "Izzy's School Signal for Scriptable" >/dev/null
  fi
}

remote_matches_target() {
  local url="$1"
  case "$url" in
    "https://github.com/$REPO_FULL_NAME"|"https://github.com/$REPO_FULL_NAME.git"|"git@github.com:$REPO_FULL_NAME.git"|"ssh://git@github.com/$REPO_FULL_NAME.git")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_origin() {
  local desired="https://github.com/$REPO_FULL_NAME.git"
  local current=""
  if current="$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null)"; then
    if ! remote_matches_target "$current"; then
      die "Existing origin points to '$current', not '$REPO_FULL_NAME'. Refusing to overwrite an unrelated remote."
    fi
    log "Verified origin remote: $current"
  else
    git -C "$PROJECT_ROOT" remote add origin "$desired"
    log "Added origin remote: $desired"
  fi
}

stage_initial_safe_snapshot() {
  log 'Staging initial project snapshot after privacy scan...'
  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    if git -C "$PROJECT_ROOT" check-ignore -q -- "$rel"; then
      log "Skipping ignored path: $rel"
      continue
    fi
    git -C "$PROJECT_ROOT" add -- "$rel"
  done < <(
    cd "$PROJECT_ROOT"
    find . -type f \
      ! -path './.git/*' \
      ! -path './node_modules/*' \
      ! -path './.codex/*' \
      ! -path './.idea/*' \
      ! -path './.vscode/*' \
      ! -name '.DS_Store' \
      -print | sed 's#^./##' | sort
  )
}

stage_release_changes_only() {
  local bundle_rel="$1"
  local targets=(
    "$README_REL"
    "$PUBLISHER_REL"
    "$UPDATES_REL"
    "$INSTALLER_REL"
    "$MANIFEST_REL"
    "$UPDATE_SOURCE_REL"
    "$bundle_rel"
  )
  log 'Staging only intended release/publisher files...'
  local target
  for target in "${targets[@]}"; do
    [[ -e "$PROJECT_ROOT/$target" ]] || die "Expected release file is missing before staging: $target"
    git -C "$PROJECT_ROOT" add -- "$target"
  done
}

commit_release() {
  if git -C "$PROJECT_ROOT" diff --cached --quiet; then
    log 'No staged changes require a new release commit.'
    return 0
  fi
  log 'Creating release commit...'
  git -C "$PROJECT_ROOT" commit -m 'release: publish stable Scriptable update channel'
}

push_main() {
  log 'Pushing main without force...'
  git -C "$PROJECT_ROOT" push -u origin main
}

urlencode_relpath() {
  REL_VALUE="$1" node -e 'process.stdout.write(process.env.REL_VALUE.split("/").map(encodeURIComponent).join("/"))'
}

set_public_urls() {
  local bundle_rel="$1"
  local enc_manifest enc_bundle enc_installer
  enc_manifest="$(urlencode_relpath "$MANIFEST_REL")"
  enc_bundle="$(urlencode_relpath "$bundle_rel")"
  enc_installer="$(urlencode_relpath "$INSTALLER_REL")"
  MANIFEST_URL="https://raw.githubusercontent.com/$OWNER/$REPO_NAME/main/$enc_manifest"
  BUNDLE_URL="https://raw.githubusercontent.com/$OWNER/$REPO_NAME/main/$enc_bundle"
  INSTALLER_URL="https://raw.githubusercontent.com/$OWNER/$REPO_NAME/main/$enc_installer"
  REPO_URL="https://github.com/$REPO_FULL_NAME"
}

curl_retry_to_file() {
  local url="$1"
  local output="$2"
  local attempt=1
  while [[ "$attempt" -le 5 ]]; do
    if curl -fsSL --connect-timeout 10 --max-time 30 "$url" -o "$output"; then
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  return 1
}

verify_published_public_urls() {
  local bundle_rel="$1"
  set_public_urls "$bundle_rel"

  if [[ "$VISIBILITY" == "private" ]]; then
    warn 'Private repository requested. Public raw Scriptable updates cannot work without authentication.'
    if curl -fsSL --connect-timeout 5 --max-time 10 "$MANIFEST_URL" -o "$TMP_DIR/private-public-probe.json" 2>/dev/null; then
      warn 'The private repository unexpectedly appears publicly readable. Review repository visibility manually.'
    else
      log 'Confirmed public raw manifest is not anonymously readable, as expected for a private repository.'
    fi
    return 0
  fi

  log 'Verifying published raw HTTPS URLs...'
  local published_manifest="$TMP_DIR/published-manifest.json"
  local published_bundle="$TMP_DIR/published-bundle.js"
  local published_installer="$TMP_DIR/published-installer.js"

  curl_retry_to_file "$MANIFEST_URL" "$published_manifest" || die "Published manifest URL is not reachable: $MANIFEST_URL"
  curl_retry_to_file "$BUNDLE_URL" "$published_bundle" || die "Published bundled script URL is not reachable: $BUNDLE_URL"
  curl_retry_to_file "$INSTALLER_URL" "$published_installer" || die "Published installer URL is not reachable: $INSTALLER_URL"

  if grep -q 'REPLACE_OWNER' "$published_manifest"; then
    die 'Published manifest still contains REPLACE_OWNER.'
  fi

  MANIFEST_FILE="$published_manifest" BUNDLE_FILE="$published_bundle" node <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_FILE, 'utf8'));
const bundle = fs.readFileSync(process.env.BUNDLE_FILE);
const actual = crypto.createHash('sha256').update(bundle).digest('hex');

function collect(obj, aliases, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    if (aliases.includes(key)) out.push(value);
    if (value && typeof value === 'object') collect(value, aliases, out);
  }
  return out;
}
const hashes = collect(manifest, ['sha256', 'sha256Hex', 'scriptSha256', 'sourceSha256'])
  .map(String).map(v => v.toLowerCase());
if (!hashes.length) throw new Error('Published manifest contains no recognized SHA-256 field.');
if (!hashes.includes(actual)) {
  throw new Error(`Published script SHA-256 ${actual} does not match manifest value(s): ${hashes.join(', ')}`);
}
console.log(`  published SHA-256 verified: ${actual}`);
NODE

  log 'Published manifest, application script, and installer are publicly reachable and verified.'
}

atomic_replace_script() {
  local source="$1"
  local destination="$2"
  local directory
  directory="$(dirname "$destination")"
  [[ -d "$directory" ]] || die "Destination directory does not exist: $directory"
  local staged
  staged="$(mktemp "$directory/.izzy-publish-stage.XXXXXX")"
  if ! cat "$source" > "$staged"; then
    find "$staged" -maxdepth 0 -type f -delete 2>/dev/null || true
    die "Could not stage replacement for: $destination"
  fi
  if ! cmp -s "$source" "$staged"; then
    find "$staged" -maxdepth 0 -type f -delete 2>/dev/null || true
    die "Staged copy verification failed for: $destination"
  fi
  if ! mv -f "$staged" "$destination"; then
    find "$staged" -maxdepth 0 -type f -delete 2>/dev/null || true
    die "Could not install staged replacement for: $destination"
  fi
  cmp -s "$source" "$destination" || die "Installed file verification failed for: $destination"
}

update_installed_scriptable() {
  local bundle_rel="$1"
  local docs="$HOME/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"
  if [[ ! -d "$docs" ]]; then
    warn "Scriptable iCloud Documents directory was not found at: $docs"
    warn 'Publication succeeded, but installed Scriptable scripts require manual verification/update.'
    return 0
  fi

  local bundle_source="$PROJECT_ROOT/$bundle_rel"
  local installer_source="$PROJECT_ROOT/$INSTALLER_REL"
  local data_directory="$docs/IzzySchoolSignal"
  local app_destination="$docs/Izzy's School Signal.js"
  local installer_destination="$docs/$(basename "$INSTALLER_REL")"

  if [[ -d "$data_directory" ]]; then
    log "Protected Scriptable user-data directory: $data_directory"
  else
    warn "Expected Scriptable data directory was not found: $data_directory"
  fi

  log 'Updating installed Scriptable application script with staged atomic replacement...'
  atomic_replace_script "$bundle_source" "$app_destination"
  log "Updated: $app_destination"

  log 'Updating installed Scriptable installer with staged atomic replacement...'
  atomic_replace_script "$installer_source" "$installer_destination"
  log "Updated: $installer_destination"

  log "Protected user data left untouched: $docs/IzzySchoolSignal"
}

publish_release() {
  assert_existing_worktree_safe

  local published_at
  published_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local result_file="$TMP_DIR/publish-bundle-rel.txt"
  local bundle_rel
  if ! perform_release_preparation "$PROJECT_ROOT" "$published_at" "$result_file"; then
    die 'Release preparation or verification failed. Repository was not created, committed, or pushed.'
  fi
  bundle_rel="$(cat "$result_file")"
  [[ -f "$PROJECT_ROOT/$bundle_rel" ]] || die "Prepared bundled script is missing: $bundle_rel"

  initialize_git_if_needed
  ensure_main_branch
  create_repo_if_needed
  ensure_origin

  if git -C "$PROJECT_ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
    stage_release_changes_only "$bundle_rel"
  else
    # First publication: publish the complete project snapshot only after the
    # privacy/credential scan has passed.
    stage_initial_safe_snapshot
  fi

  commit_release
  push_main
  verify_published_public_urls "$bundle_rel"
  update_installed_scriptable "$bundle_rel"

  set_public_urls "$bundle_rel"
  log 'PUBLICATION COMPLETE'
  log "Repository: $REPO_URL"
  if [[ "$VISIBILITY" == "public" ]]; then
    log "Manifest:   $MANIFEST_URL"
    log "Application:$BUNDLE_URL"
    log "Installer:  $INSTALLER_URL"
  else
    warn 'Repository is private; public raw update URLs are intentionally unusable without authentication.'
  fi
}

main() {
  cd "$PROJECT_ROOT"
  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/izzy-github-release.XXXXXX")"

  require_tools
  inspect_before_changes
  check_git_context_without_mutation
  check_existing_remote_repo || true

  if [[ "$VISIBILITY" == "private" ]]; then
    warn '--private explicitly disables the unauthenticated public raw update channel used by Scriptable.'
  fi

  run_dry_run

  if [[ "$MODE" == "dry-run" ]]; then
    log 'Dry run finished successfully. No publication occurred.'
    local private_suffix=""
    if [[ "$VISIBILITY" == "private" ]]; then
      private_suffix=' --private'
    fi
    log "Exact publication command: ./tools/publish-github-release.zsh --publish --repo-name '$REPO_NAME'$private_suffix"
    exit 0
  fi

  log 'Explicit --publish authorization detected. Proceeding only because the mandatory dry run passed.'
  publish_release
}

main "$@"

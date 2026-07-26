# Graph Report - plaud-server-exporter  (2026-07-26)

## Corpus Check
- 289 files · ~128,336 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1592 nodes · 4008 edges · 120 communities (97 shown, 23 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7abc39b2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- messages/index.js
- exportOrchestrator.js
- TelegramClient
- server/package.json
- scripts
- Docker Production Bootstrap Playbook
- treeBrowse.js
- exportPathUtils.js
- manifest.json
- compilerOptions
- common/plaudFolders.js
- syncRunner.js
- callbacks.js
- officialPlaudApi.js
- recordingsList.js
- inboundMessages.js
- Repository Working Contract
- plaudBrowserSession.js
- syncRunBridge.js
- extensionSyncExecutor.js
- compilerOptions
- plaudOAuth.js
- plaudBrowserApi.js
- config
- inboundMessages.js
- logger.js
- normalizeHexRecordingId
- plaudMediaFetch.js
- syncCore.js
- telegram/index.js
- domExportFallback.js
- plaudRecordings.js
- runLock.js
- Plaud Markdown Summary Exporter
- Пошаговая установка
- ActionGuard
- storageUtils.js
- Plaud Extension Popup Interface
- coverage-thresholds.mjs
- verify-shared-contract.js
- config.js
- LoadingPulse
- extensionExportAll.js
- Hybrid Direct-API and Playwright Architecture
- build-safari-app.sh
- cli/index.js
- plaudSessionExtractor.js
- verify-extension-imports.js
- verify-manifest.js
- contentHandlers.js
- Plaud Authentication Mode Choice
- Audited Sync Flow
- ci-deploy-remote.sh
- TelegramBotLoop
- scheduler.js
- plaud-i18n-messages.js
- Plaud OAuth and Developer API Spike
- Required Main Branch Status Checks
- .prettierrc.json
- lint-staged-eslint.mjs
- smoke_container.mjs
- Two-Runtime Monorepo
- Black Arch-Shaped Mark
- Agent Routing Guide
- .lintstagedrc.mjs
- exportStatusPolling.test.js
- Infrastructure Lint Workflow
- smoke-prod.sh
- Telegram Service Recovery
- Dependabot Configuration
- CodeQL Workflow
- ci-deploy-systemd-remote.sh
- loc-report.mjs
- server-as-plaud.sh
- syncRunner.integration.test.js
- Secret Storage and File Permissions
- Internal Plaud Web API
- Gitleaks Workflow
- migrate-legacy-data.sh
- cliCommands.test.js
- loadPlaudSession.test.js
- stableIdentity.test.js
- syncAudioDefault.test.js
- syncRunner.dryRun.test.js
- syncRunner.errors.test.js
- treeBrowseState.test.js
- Persistent Session, Index, and Export Policy
- ci-deploy-remote.test.sh
- ci-deploy-systemd-remote.test.sh
- docker-smoke-image.sh
- push-session-to-server.sh
- run-coverage.sh
- Extension Side of Shared Server Contract

## God Nodes (most connected - your core abstractions)
1. `logger` - 33 edges
2. `config` - 25 edges
3. `scripts` - 23 edges
4. `runSyncCore()` - 22 edges
5. `clipRichMarkdown()` - 22 edges
6. `sanitizePathSegment()` - 20 edges
7. `normalizeHumanTitle()` - 20 edges
8. `redactError()` - 20 edges
9. `TelegramClient` - 20 edges
10. `processSmartSyncFile()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Server Summary-Only Invariant` --semantically_similar_to--> `Server Summary-Only Boundary`  [INFERRED] [semantically similar]
  AGENTS.md → README.md
- `Local Bot Container Service` --semantically_similar_to--> `Production Bot Container Service`  [INFERRED] [semantically similar]
  docker-compose.yml → deploy/docker-compose.yml
- `Bind-Mounted Development State and Exports` --semantically_similar_to--> `Named Persistent Application-State Volume`  [INFERRED] [semantically similar]
  docker-compose.yml → deploy/docker-compose.yml
- `Summary-only Server Boundary` --semantically_similar_to--> `Server Audio Exclusion`  [INFERRED] [semantically similar]
  docs/ARCHITECTURE.md → server/README.md
- `Seven-Module Server–Extension Contract` --semantically_similar_to--> `Shared Server–Extension Module Contract`  [INFERRED] [semantically similar]
  AGENTS.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Plaud Export Product Runtimes** — readme_server_runtime, readme_telegram_bot, readme_chrome_extension [EXTRACTED 1.00]
- **Repository Integrity Contract** — agents_shared_server_extension_contract, agents_centralized_business_logic, agents_critical_business_scenarios, agents_verification_gate [EXTRACTED 1.00]
- **Docker Production Delivery Pipeline** — github_workflows_deploy_ghcr_image_pipeline, github_workflows_deploy_image_smoke_gate, github_workflows_deploy_docker_deployment_route, deploy_ansible_site_docker_bootstrap_playbook, deploy_docker_compose_production_stack [EXTRACTED 1.00]
- **Summary-only Server Export Invariant** — docs_architecture_summary_only_server, docs_stabilization_audit_summary_only, docs_stabilization_result_summary_only, server_readme_server_audio_exclusion [INFERRED 0.95]
- **Plaud Authentication Operating Model** — docs_getting_started_auth_mode_choice, docs_plaud_oauth_spike_auth_api_mode_matrix, docs_server_deploy_auth_transfer, docs_security_secret_storage [INFERRED 0.85]
- **Reliable File-backed Sync Architecture** — docs_architecture_disk_state, docs_stabilization_audit_durable_sync_index, docs_stabilization_result_reliable_sync, server_readme_output_contract [INFERRED 0.85]

## Communities (120 total, 23 thin omitted)

### Community 0 - "messages/index.js"
Cohesion: 0.08
Nodes (62): expandableBlockquote(), formatShortDateTimeLocal(), humanIntervalLabel(), INTERVAL_HUMAN_LABELS, ERR_TREE_AUTO_SYNC_FAILED_RICH, ERR_TREE_FILE_STILL_MISSING_RICH, ERR_TREE_LOAD_RICH, ERR_TREE_SEND_DOCUMENT_RICH (+54 more)

### Community 1 - "exportOrchestrator.js"
Cohesion: 0.08
Nodes (58): attachLocaleChangeListener(), plaudT(), syncPlaudLocale(), bytesToDataUrl(), downloadPlaudFile(), getUrlSchemeForLog(), startChromeDownload(), VALID_CONFLICT_ACTIONS (+50 more)

### Community 2 - "TelegramClient"
Cohesion: 0.09
Nodes (19): isHtmlEntitiesRejected(), retryRichSendAfterTelegramReject(), retrySendOrEditAfterTelegramReject(), blockquote(), stripBlockquotes(), stripExpandableBlockquote(), stripUnsupportedHtml(), TelegramClient (+11 more)

### Community 3 - "server/package.json"
Cohesion: 0.06
Nodes (31): dotenv, playwright, bin, plaud-server-exporter, dependencies, dotenv, description, devDependencies (+23 more)

### Community 4 - "scripts"
Cohesion: 0.09
Nodes (23): scripts, check, extension:safari, format, format:check, graphify, lint, lint:extension (+15 more)

### Community 5 - "Docker Production Bootstrap Playbook"
Cohesion: 0.06
Nodes (39): Ansible Production Defaults, Plaud VPS Inventory and Secrets Example, Container Health Gate Before Disabling systemd, Docker Production Bootstrap Playbook, Preserve Existing Effective Application Image, Legacy systemd to Docker Transition, Server-Side Local Image Build, Loopback-Only Health Endpoint (+31 more)

### Community 6 - "treeBrowse.js"
Cohesion: 0.11
Nodes (34): effectiveVaultRoot(), filesTreeFolderCallback(), parseFilesTreeFolderCallback(), handleBackFilesCallback(), handleFilesCallback(), handleFilesStatsCallback(), routeFilesTreeCallback(), buildBackToFilesKeyboard() (+26 more)

### Community 7 - "exportPathUtils.js"
Cohesion: 0.05
Nodes (96): shouldEvictStaleRunningExport(), BOILERPLATE_TITLES, DEFAULT_FILENAME_MAX_LENGTH, EXPORT_MODES, exportModeI18nKey(), extractTitleFromMarkdown(), getExportModeLabel(), isBoilerplateMarkdownHeading() (+88 more)

### Community 8 - "manifest.json"
Cohesion: 0.06
Nodes (30): action, default_icon, default_popup, background, service_worker, type, content_scripts, 128 (+22 more)

### Community 9 - "compilerOptions"
Cohesion: 0.06
Nodes (30): compilerOptions, allowJs, checkJs, esModuleInterop, lib, module, moduleResolution, noEmit (+22 more)

### Community 10 - "common/plaudFolders.js"
Cohesion: 0.05
Nodes (98): ALL_FILES_NAME_PATTERNS, ALL_FILES_SYSTEM_KINDS, attachFolderSegmentsToFiles(), buildTagByIdMap(), collectAllFilesFiletagIds(), collectQualifyingFiletagArrays(), collectUnfiledFiletagIds(), extractFiletagIdsFromRaw() (+90 more)

### Community 11 - "syncRunner.js"
Cohesion: 0.18
Nodes (22): DRAFT_UNAVAILABLE_MARKERS, EMPTY_TEXT_REJECTED_MARKERS, errorText(), isDraftUnavailable(), isEmptyTextRejected(), isRichMessageUnavailable(), matchesAny(), RICH_UNAVAILABLE_MARKERS (+14 more)

### Community 12 - "callbacks.js"
Cohesion: 0.10
Nodes (19): description, devDependencies, eslint, @eslint/js, globals, @types/chrome, eslint, @eslint/js (+11 more)

### Community 13 - "officialPlaudApi.js"
Cohesion: 0.19
Nodes (17): buildSyncFinishedKeyboard(), syncChecklistRichFrames(), syncLoadingPulseFrames(), syncSummaryHtml(), bootstrapSyncDraftAndPulse(), createImmediateProgressChannel(), createSyncProgressChannel(), createThrottledProgressChannel() (+9 more)

### Community 14 - "recordingsList.js"
Cohesion: 0.33
Nodes (13): readStatus(), editToMenuScreen(), safeCallbackRichScreen(), safeSendRich(), handleHelpCallback(), handleStatusCallback(), buildMainMenuText(), handleStart() (+5 more)

### Community 15 - "inboundMessages.js"
Cohesion: 0.19
Nodes (20): answerBestEffort(), INTERVAL_PRESETS_MIN, isAllowedInterval(), loadBotSettings(), loadEffectiveIntervalMin(), loadEffectiveScheduledSummaryVisible(), parseBoolField(), saveBotSettings() (+12 more)

### Community 16 - "Repository Working Contract"
Cohesion: 0.10
Nodes (24): Centralized Business Logic Boundaries, Critical Business Scenario Invariants, Same-Change Dead Code Removal, File-Backed Persistent State, Explicit Graphify Update Policy, Local-Host Synchronization Lock Boundary, Browser Extension Popup UI Invariants, Repository Working Contract (+16 more)

### Community 17 - "plaudBrowserSession.js"
Cohesion: 0.05
Nodes (87): clickElement(), delay(), findElementByXPath(), rightClickWithRetry(), waitForCondition(), waitForElement(), withUtf8Bom(), collectDomRecordingHexIds() (+79 more)

### Community 18 - "syncRunBridge.js"
Cohesion: 0.20
Nodes (12): classifyError(), PlaudAuthError, PlaudChangedError, SyncLockError, classifySyncFailure(), mapSyncFailureToBotOutcome(), recordAuthFailureIfNeeded(), defaultSessionLoader (+4 more)

### Community 19 - "extensionSyncExecutor.js"
Cohesion: 0.14
Nodes (13): description, engines, node, name, overrides, js-yaml, private, simple-git-hooks (+5 more)

### Community 20 - "compilerOptions"
Cohesion: 0.08
Nodes (24): ../browser-extension/common/exportPathUtils.js, ../browser-extension/common/plaudFolders.js, ../browser-extension/common/plaudRecordingIds.js, ../browser-extension/common/plaudRecordings.js, ../browser-extension/common/plaudTitles.js, ../browser-extension/common/syncCore.js, node, src/**/*.js (+16 more)

### Community 21 - "plaudOAuth.js"
Cohesion: 0.20
Nodes (20): CORS_HEADERS, errorHtml(), runOAuthCallback(), removeOAuthTokens(), createAuthorizationRequest(), createSessionFromOAuth(), exchangeOAuthCode(), execFileAsync (+12 more)

### Community 22 - "plaudBrowserApi.js"
Cohesion: 0.15
Nodes (13): eslint-config-prettier, lint-staged, markdownlint-cli2, devDependencies, eslint-config-prettier, lint-staged, markdownlint-cli2, prettier (+5 more)

### Community 23 - "config"
Cohesion: 0.21
Nodes (14): saveOAuthTokens(), ensureSecureDir(), saveSessionSnapshot(), config, normalizeLastAuthError(), recordAuthError(), writeStatusFile(), loadOffset() (+6 more)

### Community 24 - "inboundMessages.js"
Cohesion: 0.51
Nodes (9): safeSend(), COMMAND_HEAD(), COMMAND_RE(), extractCommandName(), isHelpCommand(), isMenuCommand(), isStartCommand(), isStatusCommand() (+1 more)

### Community 25 - "logger.js"
Cohesion: 0.25
Nodes (15): hashStringSync(), buildDedupeKey(), errorsDir(), errorsDirectoryInfo(), findExistingReport(), formatTimestamp(), reportError(), currentLevel() (+7 more)

### Community 26 - "normalizeHexRecordingId"
Cohesion: 0.17
Nodes (4): FOREIGN_BOTH, FOREIGN_ID, FOREIGN_USERNAME, OWNER

### Community 27 - "plaudMediaFetch.js"
Cohesion: 0.60
Nodes (8): isAllowedSender(), isAuthorizedPrivateUpdate(), isPrivateChat(), normalizeUserId(), normalizeUsername(), userIdFromPayload(), usernameFromPayload(), guardAuthorizedPrivateUpdate()

### Community 28 - "syncCore.js"
Cohesion: 0.33
Nodes (5): syncBusyText(), runScheduledSync(), syncActionKey(), syncRunGuard, okSession

### Community 29 - "telegram/index.js"
Cohesion: 0.17
Nodes (13): handleRequest(), readInitData(), startWebServer(), stopWebServer(), logger, installSignalHandlers(), MENU_COMMANDS, registerMenuCommandsSafely() (+5 more)

### Community 30 - "domExportFallback.js"
Cohesion: 0.44
Nodes (10): byChatId, clearTreeBrowseState(), ensureLoaded(), getTreeBrowseState(), isFresh(), normalizeState(), nowMs(), persist() (+2 more)

### Community 31 - "plaudRecordings.js"
Cohesion: 0.44
Nodes (6): getIndexedRecords(), getRecordByStableId(), loadIndexForBot(), isReadablePath(), loadTreeSource(), resolveSummaryPathAfterSync()

### Community 32 - "runLock.js"
Cohesion: 0.54
Nodes (7): acquireSyncLock(), isStaleLock(), lockPath(), pidIsAlive(), readLockInfo(), releaseSyncLock(), syncLockPath()

### Community 33 - "Plaud Markdown Summary Exporter"
Cohesion: 0.13
Nodes (15): File-backed Runtime State, Layered Sync Error Handling, Summary-only Server Boundary, Server Sync Flow, Telegram Read-only Sync-index Path, Classified Redacted Error Model, OAuth and Legacy Snapshot Modes, Plaud Markdown Summary Exporter (+7 more)

### Community 34 - "Пошаговая установка"
Cohesion: 0.28
Nodes (15): Архитектура Plaud Server Exporter, Пошаговая установка, Obsidian: Syncthing, Безопасность, Деплой на сервер, Исследование Plaud Server Exporter, May 2026 Architecture Snapshot, Plaud Exporter Stabilization Audit (+7 more)

### Community 36 - "storageUtils.js"
Cohesion: 0.62
Nodes (6): countOfficialOAuth(), countWebSession(), loadJson(), main(), REPO_ROOT, testOAuthOnWebEndpoint()

### Community 37 - "Plaud Extension Popup Interface"
Cohesion: 0.16
Nodes (14): Advanced Foreground and Background Export Controls, Archive Statistics and Refresh, Folder Smart-Sync Controls, Language and Theme Preferences, Plaud Tab Offline State, Plaud Extension Popup Interface, Primary Current-Summary Download, Plaud Chrome MV3 Extension (+6 more)

### Community 38 - "coverage-thresholds.mjs"
Cohesion: 0.14
Nodes (11): branchPct, failures, functionPct, include, lcovPath, linePct, minBranches, minFunctions (+3 more)

### Community 39 - "verify-shared-contract.js"
Cohesion: 0.21
Nodes (12): checkNoInlineTimestampKeyArrays(), checkRequiredFiles(), checkServerImports(), fail(), __filename, filesOk, root, SERVER_SRC (+4 more)

### Community 40 - "config.js"
Cohesion: 0.22
Nodes (7): absPath(), DATA_STATE_FILE_NAMES, dataDir(), __filename, REPO_ROOT, SERVER_ROOT, staticConfig

### Community 43 - "Hybrid Direct-API and Playwright Architecture"
Cohesion: 0.15
Nodes (13): Owner-chat Pinning, Three-layer Telegram Access Control, Mac-to-server Credential Transfer, Telegram Bot as Long-running Scheduler, Docker Deployment Mode, Mutual Exclusion of Systemd and Docker Bot Instances, Systemd CI Deployment Flow, Systemd Deployment Mode (+5 more)

### Community 44 - "build-safari-app.sh"
Cohesion: 0.29
Nodes (12): build_app(), ensure_signing_identity(), generate_xcode_project(), install_app(), install_launch_agent(), main(), open_safari_settings(), print_next_steps() (+4 more)

### Community 45 - "cli/index.js"
Cohesion: 0.18
Nodes (21): createPlaudSessionLoader(), describeAuthState(), loadPlaudSessionFromSnapshot(), loadPlaudSessionFromSnapshotDetailed(), logCliSessionLoadFailure(), describeOAuthTokens(), loadOAuthTokens(), oauthTokensFileInfo() (+13 more)

### Community 46 - "plaudSessionExtractor.js"
Cohesion: 0.21
Nodes (17): apiBaseFromSnapshot(), assertSnapshotReadyForApi(), createSessionFromSnapshot(), decodeJwtSubject(), describeSnapshot(), isLocalStorageSessionReady(), normalizeApiBase(), normalizeBearerToken() (+9 more)

### Community 50 - "verify-extension-imports.js"
Cohesion: 0.22
Nodes (9): bgJs, checkPath(), contentJs, __dirname, errors, fileExists(), globDirHasJs(), popupJs (+1 more)

### Community 51 - "verify-manifest.js"
Cohesion: 0.18
Nodes (7): errors, EXTENSION_ROOT, FORBIDDEN_PERMISSIONS, HERE, iconBuckets, MANIFEST_PATH, version

### Community 55 - "contentHandlers.js"
Cohesion: 0.42
Nodes (6): handleRunExportAll(), handleRunExportCurrentPage(), handleRunLibraryStats(), handleRunSmartSync(), registerContentMessageHandlers(), smartSyncBusyErrorKey()

### Community 56 - "Plaud Authentication Mode Choice"
Cohesion: 0.25
Nodes (9): Plaud Authentication Mode Choice, Mac Manual Sync Workflow, OAuth-first Authentication Flow, Obsidian Delivery via Syncthing, Legacy Playwright Snapshot Flow, Mac-to-VPS Manual Sync Workflow, Telegram Bot Autorun Workflow, Synced Obsidian Vault (+1 more)

### Community 57 - "Audited Sync Flow"
Cohesion: 0.28
Nodes (9): Clean Markdown with Metadata in Sync Index, Atomic Recoverable Sync Index, Safe Filename and Path Planning, Audited Summary-only Server Invariant, Audited Sync Flow, Delivered Error Visibility, Delivered Reliable Sync Behavior, Delivered Stable Filename Behavior (+1 more)

### Community 58 - "ci-deploy-remote.sh"
Cohesion: 0.44
Nodes (7): capture_systemd_state(), disable_systemd_after_docker_ok(), on_err(), remote(), rollback_systemd_if_needed(), ci-deploy-remote.sh script, stop_systemd_for_cutover()

### Community 61 - "plaud-i18n-messages.js"
Cohesion: 0.36
Nodes (5): getByPath(), getDefaultLocaleFromNavigator(), getEffectiveLocalePromise(), setLocale(), t()

### Community 62 - "Plaud OAuth and Developer API Spike"
Cohesion: 0.29
Nodes (8): Authentication and API Mode Matrix, Plaud OAuth and Developer API Spike, Official API Flat-vault Tradeoff, OAuth Token Is Not a Drop-in Web JWT Replacement, Official Plaud Developer API, Plaud CLI Documentation, Plaud MCP Documentation, Reverse-engineered Plaud Web API

### Community 65 - "Required Main Branch Status Checks"
Cohesion: 0.29
Nodes (7): Private-repository CodeQL Artifact Strategy, Checks-before-deploy Pipeline, Quality Gate, Local and CI Check Equivalence, Optional Pre-commit Gate, Progressive Quality Ratchet, Required Main Branch Status Checks

### Community 66 - ".prettierrc.json"
Cohesion: 0.29
Nodes (6): arrowParens, endOfLine, printWidth, semi, singleQuote, trailingComma

### Community 67 - "lint-staged-eslint.mjs"
Cohesion: 0.29
Nodes (6): child, eslintHoisted, eslintLocal, relFiles, ROOT, workspaceAbs

### Community 69 - "smoke_container.mjs"
Cohesion: 0.29
Nodes (6): appRoot, __dirname, modules, pkg, pkgPath, require

### Community 70 - "Two-Runtime Monorepo"
Cohesion: 0.33
Nodes (6): Server Summary-Only Invariant, Two-Runtime Monorepo, File-based Architecture Without Database or Queue, Seven-file Shared Contract, Three-layer Chrome Extension Runtime, Shared Browser-to-server Sync Logic Reuse

### Community 71 - "Black Arch-Shaped Mark"
Cohesion: 0.67
Nodes (6): Plaud Extension Icon, Black Arch-Shaped Mark, Central Black Dot, White Circular Badge, Plaud Extension Icon, Plaud Extension Icon

### Community 72 - "Agent Routing Guide"
Cohesion: 0.40
Nodes (6): Agent Routing Guide, Browser Extension Module Routing, Sync and Identity Routing, Telegram Module Routing, Change-zone Verification Matrix, July 2026 Architecture Pass

### Community 73 - ".lintstagedrc.mjs"
Cohesion: 0.53
Nodes (4): eslintForWorkspace(), join(), quote(), ROOT

### Community 75 - "Infrastructure Lint Workflow"
Cohesion: 0.40
Nodes (5): GitHub Actions Workflow Linting, Dockerfile Linting, Infrastructure Lint Workflow, Documentation Markdown Linting, Shell Script Linting

### Community 76 - "smoke-prod.sh"
Cohesion: 0.70
Nodes (4): check_api_unauth(), check_connect_html(), check_json_healthz(), smoke-prod.sh script

### Community 77 - "Telegram Service Recovery"
Cohesion: 0.50
Nodes (4): Legacy State Migration into Docker Volume, Exact-match Health Endpoint Proxy Rule, Sync-lock Diagnosis and Recovery, Telegram Service Recovery

### Community 78 - "Dependabot Configuration"
Cohesion: 0.50
Nodes (4): Dependabot Configuration, Monthly Docker Runtime Updates, Monthly Grouped GitHub Actions Updates, Weekly Grouped npm Updates

### Community 79 - "CodeQL Workflow"
Cohesion: 0.50
Nodes (4): CodeQL Workflow, JavaScript and TypeScript Security Analysis, SARIF Artifact Fallback Without GHAS, Weekly Vulnerability Pattern Reanalysis

### Community 81 - "loc-report.mjs"
Cohesion: 0.83
Nodes (3): main(), SKIP_DIRS, walkJs()

### Community 83 - "syncRunner.integration.test.js"
Cohesion: 0.67
Nodes (3): jsonResponse(), mockFetch(), session

### Community 85 - "Secret Storage and File Permissions"
Cohesion: 0.67
Nodes (3): Log and Error-report Redaction, Secret Storage and File Permissions, Plaud Session and Telegram Token Rotation

### Community 86 - "Internal Plaud Web API"
Cohesion: 0.67
Nodes (3): Internal Plaud Web API, Plaud Web LocalStorage Session Model, Plaud API Retry and Region Redirect Policy

### Community 87 - "Gitleaks Workflow"
Cohesion: 0.67
Nodes (3): Weekly Full-History Secret Rescan, Gitleaks Workflow, Repository Secret Scan

## Ambiguous Edges - Review These
- `Docker Production Bootstrap Playbook` → `Preserve Existing Effective Application Image`  [AMBIGUOUS]
  deploy/ansible/site.yml · relation: rationale_for
- `Authentication Recovery Procedure` → `Unfiled Folder Diagnostics`  [AMBIGUOUS]
  docs/troubleshooting.md · relation: conceptually_related_to

## Knowledge Gaps
- **316 isolated node(s):** `ROOT`, `singleQuote`, `trailingComma`, `printWidth`, `semi` (+311 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Docker Production Bootstrap Playbook` and `Preserve Existing Effective Application Image`?**
  _Edge tagged AMBIGUOUS (relation: rationale_for) - confidence is low._
- **What is the exact relationship between `Authentication Recovery Procedure` and `Unfiled Folder Diagnostics`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `logger` connect `telegram/index.js` to `treeBrowse.js`, `exportPathUtils.js`, `common/plaudFolders.js`, `syncRunner.js`, `cli/index.js`, `plaudSessionExtractor.js`, `recordingsList.js`, `inboundMessages.js`, `syncCore.js`, `officialPlaudApi.js`, `syncRunBridge.js`, `plaudOAuth.js`, `config`, `logger.js`, `plaudMediaFetch.js`, `scheduler.js`, `domExportFallback.js`, `plaudRecordings.js`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `config` connect `config` to `runLock.js`, `treeBrowse.js`, `exportPathUtils.js`, `common/plaudFolders.js`, `cli/index.js`, `plaudSessionExtractor.js`, `inboundMessages.js`, `plaudOAuth.js`, `logger.js`, `telegram/index.js`, `domExportFallback.js`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `normalizeHumanTitle()` connect `common/plaudFolders.js` to `plaudBrowserSession.js`, `exportPathUtils.js`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `ROOT`, `singleQuote`, `trailingComma` to the rest of the system?**
  _316 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `messages/index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07822135670236936 - nodes in this community are weakly interconnected._